
const UPLOAD_PRESET = "preparekora_mcq";

async function createSHA1(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function generateCloudinarySignature(env) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary configuration is incomplete.");
  }

  const timestamp = Math.floor(Date.now() / 1000);

  const parameters = [
    `timestamp=${timestamp}`,
    `upload_preset=${UPLOAD_PRESET}`
  ];

  const signatureString = parameters.join("&") + apiSecret;
  const signature = await createSHA1(signatureString);

  return {
    cloudName,
    apiKey,
    timestamp,
    uploadPreset: UPLOAD_PRESET,
    signature
  };
}
