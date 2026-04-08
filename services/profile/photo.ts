import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, storage } from "@/services/firebase/client";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type ProfilePhoto = {
  url: string;
  offsetX: number; // -100 to 100
  offsetY: number; // -100 to 100
};

export async function uploadProfilePhoto(
  userId: string,
  file: File
): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Only JPEG, PNG, and WebP images are allowed.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Image must be under 5 MB.");
  }

  const storageRef = ref(storage, `profilePhotos/${userId}`);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return getDownloadURL(storageRef);
}

export async function saveProfilePhotoData(
  userId: string,
  data: ProfilePhoto
): Promise<void> {
  await setDoc(
    doc(db, "users", userId),
    { profilePhoto: data },
    { merge: true }
  );
}

export async function getProfilePhotoData(
  userId: string
): Promise<ProfilePhoto | null> {
  const snap = await getDoc(doc(db, "users", userId));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  if (!d.profilePhoto) return null;
  const p = d.profilePhoto as ProfilePhoto;
  return {
    url: p.url ?? "",
    offsetX: p.offsetX ?? 0,
    offsetY: p.offsetY ?? 0,
  };
}
