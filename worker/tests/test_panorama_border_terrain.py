from pathlib import Path

from benchly.panorama.border_terrain import DegreeCell, required_glo90_cells


def test_copernicus_cell_uses_official_cog_path():
    cell = DegreeCell(46, 7)
    assert cell.stem == "Copernicus_DSM_COG_30_N46_00_E007_00_DEM"
    assert cell.url == (
        "https://copernicus-dem-90m.s3.amazonaws.com/"
        "Copernicus_DSM_COG_30_N46_00_E007_00_DEM/"
        "Copernicus_DSM_COG_30_N46_00_E007_00_DEM.tif"
    )


def test_required_border_cells_expand_around_production_coordinates(tmp_path: Path):
    index = tmp_path / "benches.tsv"
    index.write_text("\t1\tbench-a\t46.0\t7.0\n")
    assert required_glo90_cells(index, 0) == [DegreeCell(46, 7)]

    expanded = required_glo90_cells(index, 170)
    assert DegreeCell(44, 4) in expanded
    assert DegreeCell(47, 9) in expanded
