-- 011_receipt_ocr_statement_import.sql — idempotent (tables already in
-- earlier feature-coverage migrations, see receipt_uploads / statement_imports
-- in 008_full_coverage.sql). This migration only ensures the indexes the
-- new services depend on are present.
CREATE INDEX IF NOT EXISTS idx_receipt_user ON receipt_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_receipt_status ON receipt_uploads(status);
CREATE INDEX IF NOT EXISTS idx_receipt_created ON receipt_uploads(created_at);
CREATE INDEX IF NOT EXISTS idx_stmt_import_user ON statement_imports(user_id);
CREATE INDEX IF NOT EXISTS idx_stmt_import_status ON statement_imports(status);
CREATE INDEX IF NOT EXISTS idx_stmt_import_created ON statement_imports(created_at);
