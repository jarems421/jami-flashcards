import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDXpnHIRxysk5OSeMZuJ2zhRPcT-CmHK40",
  authDomain: "jami-flashcards.firebaseapp.com",
  projectId: "jami-flashcards",
  storageBucket: "jami-flashcards.firebasestorage.app",
  messagingSenderId: "418382945676",
  appId: "1:418382945676:web:2af86847fec8a2d607caa9",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  const result = await signInWithPopup(auth, provider);
  return result.user;
};