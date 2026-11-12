# 第三方素材

## Macintosh 128K

- 文件为 `public/models/macintosh_128k.glb`，约 7.62 MB。
- 作者为 kreems。
- 模型内嵌 `asset.extras` 记录了作者、原作地址与 CC BY 4.0 许可。
- 本项目在运行时替换屏幕材质，细化玻璃曲面与内边框，添加带盒光盘、电源交互及灯光。分发模型时保留作者署名、原作链接、许可链接及修改说明。

[模型原作](https://sketchfab.com/3d-models/macintosh-128k-896ea439b67b4606a23fb8b93be6af6d) · [作者](https://sketchfab.com/kreems) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## 程序与声音

Finder 桌面和 Happy Mac 开机图像由 Canvas 绘制。Web Audio 合成界面、插盘和开关机音效。应用实现代码采用项目的 MIT 许可。海绵宝宝、Macintosh 和各影片名称及角色的相关权利归各自权利人所有。

光盘封面位于 `public/media/covers/`，从站点已配置的四段视频中提取真实画面，并添加纸质封面的标题、年份和排版；同一图片也用于盘面印刷。它们是本站制作的封面，不是原版发行封面。原始画面和角色的权利归对应权利人所有，不适用项目代码的 MIT 许可。封面为预先生成的静态图片，运行时无需从视频中提取。

Happy Mac 采用经典 Macintosh 启动图标的像素轮廓，依照 BMOW 的原版图示校对机壳、五官和底座，以整数倍点阵绘制。图标相关权利归 Apple 所有。[参考图与 ROM 说明](https://www.bigmessowires.com/2015/02/05/hacking-the-happy-mac/)

## 自定义视频

默认片单已关联 `public/media/` 中的视频。为片单选择的本地替换视频通过浏览器 Blob URL 播放，页面关闭后释放。配置到 `public/media/` 的视频会随站点分发。

以下示例素材用于演示：

- `public/media/journey-1986.mp4`：《西游记》片段。
- `public/media/shenzhou-2003.mp4`：2003 年载人飞船发射素材。

上述视频未随附原作者及许可信息，相关权利归原权利人所有，不适用项目代码的 MIT 许可。

## 依赖

Three.js 和 Vite 的许可随 npm 包提供，详见各依赖的 LICENSE 文件。

GSAP 用于文字动画，适用 [GSAP Standard License](https://gsap.com/standard-license/)，许可说明见 npm 包内声明及上述链接。

## 字体

VT323 由 Peter Hull 设计，用于英文标识和数字。缝合像素字体采用 12px 比例简体中文版本，用于中文标题和电脑内部界面。两款字体均以 WOFF2 文件随站点提供，采用 SIL Open Font License 1.1，完整声明位于 `public/fonts/OFL-vt323.txt` 和 `public/fonts/OFL-fusion-pixel.txt`。[VT323](https://github.com/google/fonts/tree/main/ofl/vt323) · [缝合像素字体](https://github.com/TakWolf/fusion-pixel-font) · [缝合像素字体官方预览与字库](https://fusion-pixel-font.takwolf.com/)
