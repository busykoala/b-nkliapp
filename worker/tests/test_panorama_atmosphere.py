from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from benchly.panorama.models import SemanticClass
from benchly.panorama.watercolor import _paint_distant_atmosphere


def test_distant_marks_recede_without_changing_near_land_water_or_sky():
    # Equal texture in a near and distant patch must acquire unequal emphasis.
    pixels=np.repeat((110+((np.indices((24,72)).sum(axis=0)//3)%2)*60)[...,None],3,axis=2).astype(np.uint8)
    base=Image.fromarray(pixels,"RGB");land=Image.new("L",base.size)
    ImageDraw.Draw(land).rectangle((0,0,47,23),fill=255)
    depth=Image.new("L",base.size,180);ImageDraw.Draw(depth).rectangle((0,0,23,23),fill=0)
    _paint_distant_atmosphere(base,{SemanticClass.FOREST:land},depth,"summer")
    after=np.array(base)
    np.testing.assert_array_equal(after[:,:24],pixels[:,:24])
    np.testing.assert_array_equal(after[:,48:],pixels[:,48:])
    assert after[:,24:48].mean(axis=2).std()<pixels[:,24:48].mean(axis=2).std()*.55
    assert after[:,24:48].mean()>pixels[:,24:48].mean()


def test_atmospheric_glaze_has_no_internal_material_seam_and_retains_season():
    left=Image.new("L",(60,30));ImageDraw.Draw(left).rectangle((0,0,28,29),fill=255)
    ImageDraw.Draw(left).line((29,0,29,29),fill=128)
    right=Image.eval(left,lambda v:255-v)
    masks={SemanticClass.FOREST:left,SemanticClass.OPEN_GRASSLAND:right}
    results=[]
    for season in ("autumn","winter"):
        base=Image.new("RGB",left.size,(120,130,110))
        _paint_distant_atmosphere(base,masks,Image.new("L",base.size,180),season)
        pixels=np.array(base);assert np.ptp(pixels,axis=1).max()==0
        results.append(pixels)
    assert results[1][0,0,2]>results[0][0,0,2]+6
