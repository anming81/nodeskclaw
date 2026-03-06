# Hex 2D 素材规格

放置 2D 工作区地板纹理和家具精灵的目录。装修为逐格模式，每个占用格独立配置。

## 目录结构

```
hex2d/
  floors/
    terrazzo-diamond.png  水磨石原始素材（等轴测完整地砖，含侧面厚度）
    terrazzo-tile.png     水磨石通铺 tile（256x128，2:1 压缩顶面纹理）
    carpet-warm.svg       暖色地毯（SVG 占位）
    carpet-cool.svg       冷色地毯（SVG 占位）
    carpet-marble.svg     大理石（SVG 占位）
  furniture/
    office-chair.svg      办公椅（SVG 占位）
    office-desk.svg       办公桌（SVG 占位）
    desk-lamp.svg         台灯（SVG 占位）
    stool.svg             凳子（SVG 占位）
```

SVG 占位素材后续可替换为 Figma 导出的 PNG，需同步更新 `src/config/decorationAssets.ts` 中的 URL。

## Hex Cell 尺寸

| 参数 | 值 |
|---|---|
| HEX_SIZE | 1.2 |
| SCALE | 60 |
| HEX_RADIUS | HEX_SIZE * SCALE * 0.85 = 61.2 |

计算公式：

```
cell_width  = sqrt(3) * HEX_RADIUS ≈ 106 SVG 单位
cell_height = 2 * HEX_RADIUS ≈ 122 SVG 单位
```

## 地板纹理（通铺 tile）

地板采用 **SVG `<pattern>` 通铺** 渲染，不再使用单张大图裁切。

### 素材要求

- 格式：PNG，RGBA
- 宽高比：**2:1**（如 256x128、512x256）
- 内容：纯平面纹理，不包含 3D 厚度/侧面
- 命名：`{材质名}-tile.png`

### 通铺参数

```
TILE_W = HEX_CELL_W / 3 ≈ 35 SVG 单位（单块瓷砖宽度）
TILE_H = TILE_W / 2    ≈ 17.5 SVG 单位（单块瓷砖高度）
```

### 地板区域

地板不覆盖整个六边形，而是 hex 中心到下方 3 个顶点构成的 **60/120 度菱形**（2.5D 视角下的"地面"）。

### 从等轴测素材制作 tile

1. 裁切原始素材的顶面区域（去除 3D 侧面厚度）
2. 取中心矩形纹理样本
3. 纵向压缩为 2:1 宽高比
4. 输出 256x128 PNG

## 家具精灵

- 格式：PNG 或 SVG，透明背景
- 渲染：`<image>` + `clip-path="url(#hex-clip)"`，`preserveAspectRatio="xMidYMid meet"`
- 放置在 `furniture/` 目录下

## 素材注册

所有素材必须在 `nodeskclaw-portal/src/config/decorationAssets.ts` 中注册后才能在装修面板中使用。
