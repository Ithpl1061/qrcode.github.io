CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  label_number TEXT NOT NULL,
  product_name TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  file_url TEXT NOT NULL,
  label_image_url TEXT NOT NULL,
  label_svg_url TEXT,
  label_pdf_url TEXT,
  manifest_url TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_labels_created_at ON labels(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_labels_label_number ON labels(label_number);
CREATE INDEX IF NOT EXISTS idx_labels_batch_number ON labels(batch_number);
