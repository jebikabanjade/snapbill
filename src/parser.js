/**
 * Best-effort regex extraction of invoice fields from OCR text.
 * Everything is optional — the PDF still generates with just the raw text.
 */

export function parseInvoice(rawText) {
  const text = String(rawText ?? '');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const result = {
    vendor: null,
    recipient: null,
    invoiceNumber: null,
    date: null,
    items: [],
    total: null,
    rawText: text
  };

  // Vendor: first non-empty line, unless it looks like "Invoice #..."
  if (lines[0] && !/^invoice/i.test(lines[0])) {
    result.vendor = lines[0];
  }

  // Recipient: line starting with "to " (case insensitive)
  const recipientLine = lines.find((l) => /^to\s+/i.test(l));
  if (recipientLine) {
    result.recipient = recipientLine.replace(/^to\s+/i, '').trim();
  }

  // Invoice number
  const invoiceMatch = text.match(/invoice\s*#?\s*:?\s*([A-Z0-9-]+)/i);
  if (invoiceMatch) result.invoiceNumber = invoiceMatch[1];

  // Date (YYYY-MM-DD, DD/MM/YYYY, MM-DD-YYYY, etc.)
  const dateMatch = text.match(
    /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/
  );
  if (dateMatch) result.date = dateMatch[1];

  // Line items: lines like "1) Desc — 10PC — 1000$ — 10000$"
  const itemPattern =
    /^\d+\)\s*(.+?)\s*[—\-–]\s*(.+?)\s*[—\-–]\s*([\d.,]+)\$?\s*[—\-–]\s*([\d.,]+)\$?/;
  for (const line of lines) {
    const m = itemPattern.exec(line);
    if (m) {
      result.items.push({
        description: m[1].trim(),
        quantity: m[2].trim(),
        unitPrice: m[3].trim(),
        amount: m[4].trim()
      });
    }
  }

  // Grand total (prefer "Grand total" over "Total")
  const grandMatch = text.match(/grand\s*total\s*[—\-–:]*\s*([\d.,]+)\$?/i);
  if (grandMatch) {
    result.total = grandMatch[1];
  } else {
    const totalMatch = text.match(/total\s*[—\-–:]*\s*([\d.,]+)\$?/i);
    if (totalMatch) result.total = totalMatch[1];
  }

  return result;
}