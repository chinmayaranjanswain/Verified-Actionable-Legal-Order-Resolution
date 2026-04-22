// V.A.L.O.R. — PDF Text Extraction using PDF.js

let pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;

  // Load PDF.js from CDN
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
      script.type = 'module';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    // Also try global import approach
    const mod = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
    window.pdfjsLib = mod;
    mod.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
  }

  pdfjsLib = window.pdfjsLib;
  return pdfjsLib;
}

export async function extractTextFromPDF(file, onProgress) {
  const lib = await loadPdfJs();

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = lib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const totalPages = pdf.numPages;
  let fullText = '';
  let hasText = false;

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');

    if (pageText.trim().length > 10) {
      hasText = true;
    }

    fullText += `--- Page ${i} ---\n${pageText}\n\n`;

    if (onProgress) {
      onProgress(Math.round((i / totalPages) * 100));
    }
  }

  return {
    text: fullText.trim(),
    pageCount: totalPages,
    isScanned: !hasText,
    method: hasText ? 'digital' : 'needs-ocr'
  };
}

export async function renderPageToCanvas(file, pageNum) {
  const lib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(pageNum);

  const scale = 2.0;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport
  }).promise;

  return canvas;
}
