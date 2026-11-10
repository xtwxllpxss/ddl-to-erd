import { preview } from './diagram.js';

export async function diagramPng(model) {
  const { width, height } = model;
  const svg = new XMLSerializer().serializeToString(preview(model));
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // Stay within browser canvas limits, including on mobile.
    const scale = Math.min(2, 4096 / Math.max(width, height),
      Math.sqrt(12_000_000 / (width * height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Не удалось создать PNG.')), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
