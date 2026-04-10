import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { auth, db, storage } from "@/services/firebase/client";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const UPLOAD_TIMEOUT_MS = 30_000;

function getFileExtension(file: File) {
  switch (file.type) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
    default:
      return "jpg";
  }
}

function getUploadErrorMessage(error: unknown) {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "storage/unauthorized":
        return "You are not allowed to upload a profile photo right now. Sign in again and try once more.";
      case "storage/canceled":
        return "The upload was canceled before it finished.";
      case "storage/quota-exceeded":
        return "Storage is temporarily unavailable. Please try again later.";
      case "storage/retry-limit-exceeded":
        return "The upload took too long. Check your connection and try again.";
      default:
        return error.message || "The profile photo upload failed.";
    }
  }

  return error instanceof Error ? error.message : "The profile photo upload failed.";
}

export type ProfilePhoto = {
  url: string;
  offsetX: number; // -100 to 100
  offsetY: number; // -100 to 100
};

export async function uploadProfilePhoto(
  userId: string,
  file: File
): Promise<string> {
  const currentUser = auth.currentUser;

  if (!currentUser || currentUser.uid !== userId) {
    throw new Error("Sign in again before changing your profile photo.");
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Only JPEG, PNG, and WebP images are allowed.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Image must be under 5 MB.");
  }

  const fileName = `avatar-${Date.now()}.${getFileExtension(file)}`;
  const storageRef = ref(storage, `profilePhotos/${userId}/${fileName}`);

  try {
    await currentUser.getIdToken(true);

    return await new Promise<string>((resolve, reject) => {
      const uploadTask = uploadBytesResumable(storageRef, file, {
        contentType: file.type,
        cacheControl: "public,max-age=31536000,immutable",
      });

      const timeout = window.setTimeout(() => {
        uploadTask.cancel();
        reject(
          new Error(
            "The upload took too long. Check your connection and try again."
          )
        );
      }, UPLOAD_TIMEOUT_MS);

      uploadTask.on(
        "state_changed",
        undefined,
        (error) => {
          window.clearTimeout(timeout);
          reject(new Error(getUploadErrorMessage(error)));
        },
        async () => {
          try {
            window.clearTimeout(timeout);
            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(downloadUrl);
          } catch (error) {
            reject(new Error(getUploadErrorMessage(error)));
          }
        }
      );
    });
  } catch (error) {
    throw new Error(getUploadErrorMessage(error));
  }
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
