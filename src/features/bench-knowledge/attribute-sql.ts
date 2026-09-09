/** The b alias is a canonical bench. An explicit unresolved state must not fall back to an old tag. */
export function attributeValueSql(field: "backrest" | "armrest" | "covered" | "wheelchair" | "material" | "seats") {
  return `json_extract(coalesce((SELECT coalesce(k.value_json,'null') FROM bench_attribute_state k
    WHERE k.bench_row_id=b.row_id AND k.attribute='${field}'
      AND julianday(k.resolved_at)>=coalesce((SELECT max(julianday(m.created_at)) FROM bench_metadata_edits m WHERE m.bench_row_id=b.row_id AND m.field='${field}'),0)
      AND (b.osm_timestamp IS NULL OR julianday(k.resolved_at)>=julianday(b.imported_at))),json_quote(b.${field})),'$')`;
}
