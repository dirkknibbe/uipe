DETECTION_PROMPT = (
    "Detect the UI elements in this screenshot. Return ONLY a JSON array; each item: "
    '{"label": one of [button,input,link,image,text,icon,dropdown,checkbox,radio,tab,other], '
    '"confidence": 0..1, "bbox": {"x","y","w","h"} in pixels, '
    '"text": visible text or null, "is_interactable": bool}. No prose.'
)
