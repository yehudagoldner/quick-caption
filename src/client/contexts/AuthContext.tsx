import { setApiUser } from "../api";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { createDevAuthUser, isDevAuthBypass } from "../devAuth";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  isDevBypass: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, "") ?? "";

async function syncUser(user: User) {
  try {
    const idToken = await user.getIdToken();
    const response = await fetch(`${API_BASE_URL}/api/users/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
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
    if (!response.ok) throw new Error("Account synchronization failed");
  } catch (error) {
    console.error("Failed to sync user", error);
    throw error;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => {
    const initial = isDevAuthBypass ? createDevAuthUser() : null;
    setApiUser(initial);
    return initial;
  });
  const setUser = (next: User | null, ready?: Promise<void>) => { setApiUser(next, ready); setUserState(next); };
  const [loading, setLoading] = useState(!isDevAuthBypass);

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
        setUser(firebaseUser, firebaseUser ? syncUser(firebaseUser) : undefined);
        setLoading(false);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
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
      const ready = syncUser(credential.user);
      setUser(credential.user, ready);
      await ready;
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
    await signOut(auth);
  };

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, isDevBypass: isDevAuthBypass, signIn: handleSignIn, signOut: handleSignOut }),
    [user, loading],
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
