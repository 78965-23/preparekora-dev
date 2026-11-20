const UPLOAD_PRESET = "preparekora_mcq";

async function sha1(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", data);

  return new Uint8Array(digest);
}

function toHex(bytes) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function generateCloudinarySignature(env) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary configuration is incomplete.");
  }

  const timestamp = Math.floor(Date.now() / 1000);

  const parameters = {
    upload_preset: UPLOAD_PRESET,
    timestamp
  };

  const signatureString =
    Object.keys(parameters)
      .sort()
      .map(key => `${key}=${parameters[key]}`)
      .join("&") + apiSecret;

  const signature = toHex(
    await sha1(signatureString)
  );

  return {
    cloudName,
    apiKey,
    timestamp,
    uploadPreset: UPLOAD_PRESET,
    signature
  };
}

export async function createAuthenticatedDeliveryUrl(env, asset) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiSecret = env.CLOUDINARY_API_SECRET;

  if (
    !cloudName ||
    !apiSecret ||
    !asset?.publicId ||
    !asset?.version ||
    !asset?.format
  ) {
    throw new Error("Authenticated image details are incomplete.");
  }

  const version = Number(asset.version);

  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error("Invalid Cloudinary asset version.");
  }

  const publicId = String(asset.publicId);
  const format = String(asset.format);

  const resourcePath =
    `v${version}/${publicId}.${format}`;

  const signature = toBase64Url(
    await sha1(resourcePath + apiSecret)
  ).slice(0, 8);

  const encodedPublicId = publicId
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return (
    `https://res.cloudinary.com/${cloudName}` +
    `/image/authenticated/s--${signature}--` +
    `/v${version}/${encodedPublicId}.${encodeURIComponent(format)}`
  );
}
