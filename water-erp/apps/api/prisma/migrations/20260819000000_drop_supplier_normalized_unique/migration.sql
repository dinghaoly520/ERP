-- 公司名允许重复：移除 normalizedName 唯一约束，唯一标识改由统一社会信用代码（creditCode）承担
DROP INDEX IF EXISTS "Supplier_normalizedName_key";
