import PDFDocument from 'pdfkit';

/**
 * Build a PDF from parsed invoice data.
 * Returns a Promise that resolves to a Buffer.
 */
export function buildInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];

      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(24).fillColor('#000').text('INVOICE', { align: 'center' });
      doc.moveDown(1.5);

      // Meta block
      doc.fontSize(11).fillColor('#333');
      if (invoice.vendor) doc.text(`From: ${invoice.vendor}`);
      if (invoice.recipient) doc.text(`To:   ${invoice.recipient}`);
      if (invoice.invoiceNumber) doc.text(`Invoice #: ${invoice.invoiceNumber}`);
      if (invoice.date) doc.text(`Date: ${invoice.date}`);
      doc.moveDown(1);

      // Divider
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor('#ccc')
        .stroke();
      doc.moveDown(0.5);

      // Table header
      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      doc.fontSize(12).fillColor('#000').text('Description', left, doc.y, {
        continued: true
      });
      doc.text('Amount', right - 100, doc.y, { width: 100, align: 'right' });
      doc.moveDown(0.5);

      // Items
      doc.fontSize(11).fillColor('#222');
      if (invoice.items.length === 0) {
        doc.text('(No line items detected — see raw transcription below)');
        doc.moveDown(0.5);
      } else {
        for (const item of invoice.items) {
          const desc = item.quantity
            ? `${item.description} (${item.quantity})`
            : item.description;
          const amountStr = item.amount ? `$${item.amount}` : '';
          doc.text(desc, left, doc.y, { continued: true, width: right - left - 100 });
          doc.text(amountStr, { width: 100, align: 'right' });
          doc.moveDown(0.3);
        }
      }

      doc.moveDown(0.5);

      // Divider
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor('#ccc')
        .stroke();
      doc.moveDown(0.7);

      // Total
      if (invoice.total) {
        doc
          .fontSize(14)
          .fillColor('#000')
          .text(`Total: $${invoice.total}`, { align: 'right' });
      }

      // Raw transcription appendix
      doc.moveDown(2);
      doc.fontSize(9).fillColor('#888').text('— Raw transcription —', {
        align: 'center'
      });
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor('#555').text(invoice.rawText || '(empty)', {
        align: 'left'
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}