import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { auth, isFirebaseConfigured } from "./firebase-client.js";

const adminUids = new Set(["yZlWYVacbThKYgPnKgGJxAYCJIi2"]);

export function watchAdmin(callback) {
  if (!isFirebaseConfigured || !auth) {
    callback({ user: null, isAdmin: false, error: "Firebase is not configured." });
    return () => {};
  }
  return onAuthStateChanged(auth, async user => {
    if (!user) return callback({ user: null, isAdmin: false });
    if (adminUids.has(user.uid)) return callback({ user, isAdmin: true });
    try {
      const token = await user.getIdTokenResult(true);
      callback({ user, isAdmin: token.claims.admin === true });
    } catch (error) {
      callback({ user, isAdmin: false, error: error.message });
    }
  });
}

export async function login(email, password) {
  if (!isFirebaseConfigured || !auth) throw new Error("Firebase is not configured. Follow the setup instructions in README.md.");
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  if (auth) await signOut(auth);
}
