// ============================================
// Firebase Configuration
// ============================================
// Replace with your Firebase project credentials.
// Get these from: Firebase Console > Project Settings > General > Your apps
// ============================================

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// ---- Load Firebase SDK dynamically ----
const FIREBASE_VERSION = "10.12.0";
const cdnBase = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function initFirebase() {
  await loadScript(`${cdnBase}/firebase-app-compat.js`);
  await Promise.all([
    loadScript(`${cdnBase}/firebase-auth-compat.js`),
    loadScript(`${cdnBase}/firebase-firestore-compat.js`)
  ]);

  firebase.initializeApp(firebaseConfig);

  window.auth = firebase.auth();
  window.db = firebase.firestore();
  window.googleProvider = new firebase.auth.GoogleAuthProvider();

  return { auth: window.auth, db: window.db };
}
