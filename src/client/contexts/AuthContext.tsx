import { setApiUser, apiFetch, apiAuthEpoch } from "../api";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { createDevAuthUser, isDevAuthBypass } from "../devAuth";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  isDevBypass: boolean;
  connectionNotice: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function syncUser(user: User) {
  try {
    await apiFetch(`${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/users/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        phoneNumber: user.phoneNumber,
        emailVerified: user.emailVerified,
        providerId: user.providerData?.[0]?.providerId,
        lastLoginAt: user.metadata?.lastSignInTime ?? null,
      }),
    });
  } catch (error) {
    console.error("Failed to sync user", error);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => {
    const initial = isDevAuthBypass ? createDevAuthUser() : null;
    setApiUser(initial);
    return initial;
  });
  const setUser = (next: User | null) => { setApiUser(next); setUserState(next); };
  const [loading, setLoading] = useState(!isDevAuthBypass);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);

  useEffect(() => {
    const revoked = async (event: Event) => {
      if (isDevAuthBypass) return;
      const uid = (event as CustomEvent).detail?.uid;
      const epoch = (event as CustomEvent).detail?.epoch ?? apiAuthEpoch();
      const { auth } = await import('../firebase');
      if (auth.currentUser?.uid !== uid || epoch !== apiAuthEpoch()) return;
      setConnectionNotice('החיבור במכשיר הזה נותק. יש להתחבר מחדש כדי להמשיך.');
      setUser(null);
      await signOut(auth);
    };
    const listener = (event: Event) => { void revoked(event).catch(() => {}); };
    window.addEventListener('qc-connection-revoked', listener);
    return () => window.removeEventListener('qc-connection-revoked', listener);
  }, []);

  useEffect(() => {
    if (isDevAuthBypass) {
      setUser(createDevAuthUser());
      setLoading(false);
      return;
    }

    let cancelled = false;
    let unsubscribe = () => {};

    void import("../firebase").then(({ auth }) => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        setUser(firebaseUser);
        setLoading(false);
        if (firebaseUser) {
          void syncUser(firebaseUser);
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    setConnectionNotice(null);
    if (isDevAuthBypass) {
      setUser(createDevAuthUser());
      return;
    }

    setLoading(true);
    try {
      const { auth } = await import("../firebase");
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(auth, provider);
      setUser(credential.user);
      await syncUser(credential.user);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (isDevAuthBypass) {
      setUser(null);
      return;
    }
    const { auth } = await import("../firebase");
    const response = await apiFetch(`${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/connections/logout`, { method: 'POST' });
    if (!response.ok && response.status !== 401) throw new Error('לא ניתן לנתק את החיבור כרגע. נסו שוב.');
    await signOut(auth);
  };

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, isDevBypass: isDevAuthBypass, connectionNotice, signIn: handleSignIn, signOut: handleSignOut }),
    [user, loading, connectionNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
