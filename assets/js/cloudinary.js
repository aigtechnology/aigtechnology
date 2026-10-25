import { cloudinaryConfig } from "./firebase-config.js";

export async function uploadProductImage(file, onProgress = () => {}) {
  if (!file || typeof file.size !== "number" || typeof file.type !== "string") {
    throw new Error("Choose an image file before uploading.");
  }
  if (!cloudinaryConfig.cloudName || !cloudinaryConfig.unsignedUploadPreset) {
    throw new Error("Cloudinary is not configured. Set the cloud name and unsigned preset in assets/js/firebase-config.js.");
  }
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    throw new Error("Unsupported image type. Choose a JPEG, PNG, or WebP file.");
  }
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) {
    throw new Error("The image must be larger than 0 bytes and no larger than 8 MB.");
  }

  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", cloudinaryConfig.unsignedUploadPreset);

  const result = await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinaryConfig.cloudName)}/image/upload`);
    request.timeout = 120000;
    request.upload.addEventListener("progress", event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      let body;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = null;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(body?.error?.message || request.responseText || `Cloudinary upload failed with HTTP ${request.status}.`));
        return;
      }
      resolve(body);
    });
    request.addEventListener("error", () => reject(new Error("The Cloudinary request failed. Check your connection and try again.")));
    request.addEventListener("timeout", () => reject(new Error("The Cloudinary upload timed out. Try a smaller image or retry.")));
    request.addEventListener("abort", () => reject(new Error("The Cloudinary upload was cancelled.")));
    request.send(form);
  });

  if (!result?.secure_url || !result?.public_id || !result?.format) {
    throw new Error("Cloudinary returned an incomplete upload response. No image reference was saved.");
  }
  const secureUrl = new URL(result.secure_url);
  if (secureUrl.protocol !== "https:" || secureUrl.hostname !== "res.cloudinary.com") {
    throw new Error("Cloudinary returned an unexpected image URL. No image reference was saved.");
  }
  return {
    url: result.secure_url,
    publicId: result.public_id,
    alt: file.name.replace(/\.[^.]+$/, "").slice(0, 120)
  };
}
