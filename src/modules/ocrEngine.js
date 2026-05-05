let worker = null;

async function loadTesseract() {
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return window.Tesseract;
}

export async function performOCR(file, onProgress) {
  const Tesseract = await loadTesseract();
  const { renderPageToCanvas } = await import('./pdfProcessor.js');
  const { extractTextFromPDF } = await import('./pdfProcessor.js');
  const pdfResult = await extractTextFromPDF(file, () => {});
  const totalPages = pdfResult.pageCount;

  let fullText = '';
  worker = await Tesseract.createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    }
  });

  for (let i = 1; i <= totalPages; i++) {
    const canvas = await renderPageToCanvas(file, i);
    const { data } = await worker.recognize(canvas);
    fullText += `--- Page ${i} (OCR) ---\n${data.text}\n\n`;

    if (onProgress) {
      onProgress(Math.round((i / totalPages) * 100));
    }
  }

  await worker.terminate();
  worker = null;

  return {
    text: fullText.trim(),
    pageCount: totalPages,
    isScanned: true,
    method: 'ocr'
  };
}

export function terminateOCR() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
