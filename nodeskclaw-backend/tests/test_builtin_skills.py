from pathlib import Path

from app.startup.builtin_skills import load_builtin_skill_specs


def test_load_builtin_skill_specs_from_catalog():
    specs = load_builtin_skill_specs(Path("app/data/builtin_skills"))

    assert len(specs) >= 4
    slug_set = {item.slug for item in specs}
    assert "viral-hunter" in slug_set
    assert "script-creator" in slug_set

    hunter = next(item for item in specs if item.slug == "viral-hunter")
    assert hunter.manifest["skill"]["content"]
    assert hunter.manifest["_builtin"]["checksum"] == hunter.checksum
    assert hunter.version == "1.0.0"
