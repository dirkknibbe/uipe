import sys
import app.main as main_mod


def test_app_attribute_is_lazy(monkeypatch):
    # PEP 562: accessing the module-level `app` must invoke build_default_app
    # lazily (it must NOT be shadowed by a real `app` global). Monkeypatch the
    # builder so we don't construct the real (torch-requiring) analyzer.
    monkeypatch.setattr(main_mod, "build_default_app", lambda: "SENTINEL_APP")
    assert main_mod.app == "SENTINEL_APP"


def test_importing_main_does_not_import_torch():
    # Importing the app module (as the unit tests do) must not pull in torch;
    # the model libs load only when the real analyzer is built on the GPU.
    assert "torch" not in sys.modules
