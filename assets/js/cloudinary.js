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

export async function uploadHomepageMedia(file, resourceType = "image", onProgress = () => {}) {
  if (!file || typeof file.size !== "number" || typeof file.type !== "string") throw new Error("Choose a file before uploading.");
  if (!cloudinaryConfig.cloudName || !cloudinaryConfig.unsignedUploadPreset) throw new Error("Cloudinary is not configured.");
  const isVideo = resourceType === "video";
  const allowed = isVideo ? ["video/mp4", "video/webm", "video/quicktime"] : ["image/jpeg", "image/png", "image/webp"];
  const maxSize = isVideo ? 100 * 1024 * 1024 : 8 * 1024 * 1024;
  if (!allowed.includes(file.type)) throw new Error(isVideo ? "Use an MP4, WebM, or MOV video." : "Use a JPEG, PNG, or WebP image.");
  if (file.size <= 0 || file.size > maxSize) throw new Error(`The ${isVideo ? "video" : "image"} is too large.`);
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", cloudinaryConfig.unsignedUploadPreset);
  const result = await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinaryConfig.cloudName)}/${isVideo ? "video" : "image"}/upload`);
    request.timeout = 300000;
    request.upload.addEventListener("progress", event => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); });
    request.addEventListener("load", () => {
      let body = null;
      try { body = JSON.parse(request.responseText); } catch {}
      if (request.status < 200 || request.status >= 300) return reject(new Error(body?.error?.message || `Cloudinary upload failed with HTTP ${request.status}.`));
      resolve(body);
    });
    request.addEventListener("error", () => reject(new Error("The Cloudinary upload failed.")));
    request.addEventListener("timeout", () => reject(new Error("The Cloudinary upload timed out.")));
    request.send(form);
  });
  const url = new URL(result?.secure_url || "");
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || !result.public_id) throw new Error("Cloudinary returned an invalid media URL.");
  return { url: result.secure_url, publicId: result.public_id, resourceType: isVideo ? "video" : "image" };
}
