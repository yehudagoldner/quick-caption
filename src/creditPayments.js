import { getCreditPackage } from './creditPackages.js';

export async function creditPayment(connection, { orderId, captureId, userUid, credits, amountUSD }) {
  const pkg = getCreditPackage(credits);
  if (!pkg || pkg.priceUSD !== amountUSD || !orderId || !captureId || !userUid) throw new Error('Invalid payment details');
  try {
    await connection.beginTransaction();
    let credited = true;
    try {
      await connection.execute(
        'INSERT INTO credit_payments (paypal_order_id, paypal_capture_id, user_uid, credits, amount_usd) VALUES (?, ?, ?, ?, ?)',
        [orderId, captureId, userUid, credits, amountUSD],
      );
    } catch (error) {
      // Only a unique-key conflict can be an idempotent retry. Never suppress other SQL failures.
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      const [payments] = await connection.execute(
        'SELECT paypal_order_id, paypal_capture_id, user_uid, credits, amount_usd FROM credit_payments WHERE paypal_order_id = ? OR paypal_capture_id = ? FOR UPDATE',
        [orderId, captureId],
      );
      if (payments.length !== 1 || payments[0].paypal_order_id !== orderId || payments[0].paypal_capture_id !== captureId || payments[0].user_uid !== userUid || payments[0].credits !== credits || Number(payments[0].amount_usd) !== Number(amountUSD)) {
        throw new Error('Payment already recorded with different details');
      }
      credited = false;
    }
    if (credited) {
      const [update] = await connection.execute('UPDATE users SET credits = credits + ? WHERE uid = ?', [credits, userUid]);
      if (update.affectedRows !== 1) throw new Error('User not found');
    }
    const [users] = await connection.execute('SELECT credits FROM users WHERE uid = ? FOR UPDATE', [userUid]);
    if (!users.length) throw new Error('User not found');
    await connection.commit();
    return { credited, newBalance: users[0].credits };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
