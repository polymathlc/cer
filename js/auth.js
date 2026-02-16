// ============================================
// Authentication Module
// ============================================

const Auth = (() => {
  function showError(msg) {
    const el = document.getElementById("auth-error");
    el.textContent = msg;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 5000);
  }

  function clearError() {
    document.getElementById("auth-error").classList.add("hidden");
  }

  // Email/Password Login
  async function loginWithEmail(email, password) {
    clearError();
    if (!email || !password) {
      showError("Please enter email and password.");
      return null;
    }
    try {
      const result = await auth.signInWithEmailAndPassword(email, password);
      return result.user;
    } catch (err) {
      showError(friendlyError(err.code));
      return null;
    }
  }

  // Email/Password Register
  async function registerWithEmail(name, email, password) {
    clearError();
    if (!name || !email || !password) {
      showError("Please fill in all fields.");
      return null;
    }
    if (password.length < 6) {
      showError("Password must be at least 6 characters.");
      return null;
    }
    try {
      const result = await auth.createUserWithEmailAndPassword(email, password);
      await result.user.updateProfile({ displayName: name });
      return result.user;
    } catch (err) {
      showError(friendlyError(err.code));
      return null;
    }
  }

  // Google Sign-In
  async function loginWithGoogle() {
    clearError();
    try {
      const result = await auth.signInWithPopup(googleProvider);
      return result.user;
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        showError(friendlyError(err.code));
      }
      return null;
    }
  }

  // Sign Out
  async function logout() {
    await auth.signOut();
  }

  // Auth state listener
  function onAuthChanged(callback) {
    auth.onAuthStateChanged(callback);
  }

  function friendlyError(code) {
    const map = {
      "auth/user-not-found": "No account found with this email.",
      "auth/wrong-password": "Incorrect password.",
      "auth/email-already-in-use": "An account with this email already exists.",
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/weak-password": "Password must be at least 6 characters.",
      "auth/too-many-requests": "Too many attempts. Please try again later.",
      "auth/network-request-failed": "Network error. Check your connection.",
      "auth/invalid-credential": "Invalid email or password."
    };
    return map[code] || "Something went wrong. Please try again.";
  }

  return {
    loginWithEmail,
    registerWithEmail,
    loginWithGoogle,
    logout,
    onAuthChanged
  };
})();
