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

async function syncUser(user: User) {
  try {
    await fetch("/api/users/sync", {
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
  const [user, setUser] = useState<User | null>(isDevAuthBypass ? createDevAuthUser() : null);
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
