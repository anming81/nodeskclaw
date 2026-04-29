# builtin_skills

内置技能采用「一技能一目录」管理：

- `catalog.json`：技能索引，定义 slug、版本、标签、工具白名单等元数据。
- `<slug>/SKILL.md`：技能正文（front matter + 规则说明）。

启动流程：

1. `app.startup.builtin_skills.seed_builtin_skills` 读取 `catalog.json`。
2. 逐个加载 `<slug>/SKILL.md`，拼装为 `genes.manifest.skill.content`。
3. 计算内容校验和（checksum）并写入 `manifest._builtin.checksum`。
4. 若数据库中同 slug 技能不存在则创建；存在且 checksum/version 变化则增量升级。

升级策略：

- 只修改某个 `SKILL.md` 或 `catalog.json` 的版本字段，即可在下次启动时自动升级对应技能。
- 未变化技能不会重复写库。
