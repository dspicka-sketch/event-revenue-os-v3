-- Buyer-paid line items (D15). NULL = the source did not itemize fees (unknown, never zero).
ALTER TABLE orders ADD COLUMN facility_fee_minor bigint, ADD COLUMN promoter_rebate_minor bigint;
ALTER TABLE order_lines ADD COLUMN facility_fee_minor bigint, ADD COLUMN promoter_rebate_minor bigint;
