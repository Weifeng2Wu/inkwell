export function promptImages(value, supportsImages) {
  const images = value ?? [];
  if (
    !Array.isArray(images) ||
    images.length > 4 ||
    images.some(
      (image) =>
        !image ||
        !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType) ||
        typeof image.data !== "string" ||
        image.data.length > 327680 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data),
    )
  )
    throw new Error("Invalid or oversized image attachments.");
  if (images.length && !supportsImages)
    throw new Error("The selected model does not support image attachments.");
  return images.map(({ mimeType, data }) => ({ type: "image", mimeType, data }));
}
