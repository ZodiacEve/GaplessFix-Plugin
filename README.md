# GaplessFix

最近在用Windows桌面版网易云音乐听 She Her Her Hers 的《location》时，《because I know》接《Episode 33》总会顿一下，大概500毫秒的空白。手机上没有这种情况，但是对前后结尾开头连续的两首曲目来说听感大打折扣。

GaplessFix 是一个 BetterNCM 插件。它会提前解码下一首，让两首歌在同一个音频时钟上衔接。

目前只在 **网易云 Windows 3.1.41.205564 + BetterNCM 1.3.4** 上测试过。上面这两首已经能自然接上，听感和系统输出录音都没有再出现原来的空窗。

## 注意事项

- **仅联网使用有效。** 插件通过当前登录账号取得在线音频，并不读取ncm文件。
- 第一首需要先把整首在线音频加载到内存并解码，可能会多等一会儿。下一首会在后台提前准备。插件不会另存一份歌曲文件，但会增加内存和网络占用。

## 安装

先装好 [BetterNCM](https://github.com/std-microblock/chromatic/tree/v2)，然后完全退出网易云，包括托盘图标。

下载这个仓库的 ZIP 并解压，把包含 `manifest.json` 和 `main.js` 的目录放到：

```text
C:\betterncm\plugins_dev\GaplessFix\
```

重新打开网易云即可。

## 卸载

退出网易云，移走 `plugins_dev\GaplessFix` 文件夹，再打开网易云，就会恢复原生播放。BetterNCM 和其他插件不受影响。

或者运行：

```powershell
.\uninstall.ps1
# 自定义目录同样支持 -BetterNCMProfile
```

脚本会把插件移到 `plugins_backup`，不会直接删除。需要恢复时，把备份目录放回 `plugins_dev\GaplessFix` 即可。

## 遇到问题

先确认客户端版本。这里用到了网易云的内部接口，升级后可能需要重新适配。

能正常播放但仍有间隙时，可以在客户端 DevTools 控制台里查看：

```js
GaplessFix.snapshot()
```

`pcm` 表示正在使用插件输出，`native-fallback` 表示已经回到原生播放器。`next` 有内容，说明下一首已经排好。

如果遇到问题请带上客户端版本、BetterNCM 版本、歌曲名再报告。

## 致谢

感谢 [BetterNCM](https://github.com/std-microblock/chromatic/tree/v2) 提供插件接口，以及 [ncm-orpheus](https://github.com/SUPERtongmeng/ncm-orpheus) 对网易云 3.x 接口的整理。

MIT License，见 [LICENSE](LICENSE)。
