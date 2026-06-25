# ForgeFlow Local - Start Here

## 中文

解压后，先看这里。

### Mac 用户

优先双击：

```text
Start ForgeFlow.command
```

如果 macOS 提示“Apple 无法验证是否包含恶意软件”，这是因为 ForgeFlow 当前是未签名的本地工具，不是 App Store 应用。

你可以这样打开：

1. 按住 `Control`，点击 `Start ForgeFlow.command`
2. 选择 **打开**
3. 如果仍然被拦截，打开 **系统设置 -> 隐私与安全性**
4. 找到刚刚被拦截的 ForgeFlow 启动项，点击 **仍要打开**

如果你熟悉终端，也可以在解压后的文件夹里运行：

```bash
xattr -dr com.apple.quarantine .
./start.command
```

### Windows 用户

双击：

```text
Start ForgeFlow.bat
```

### 启动后打开

```text
http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html
```

## English

After unzipping, start here.

### Mac

Double-click:

```text
Start ForgeFlow.command
```

If macOS says Apple cannot verify the file, it is because ForgeFlow is currently an unsigned local tool, not a notarized App Store app.

Open it this way:

1. Hold `Control` and click `Start ForgeFlow.command`
2. Choose **Open**
3. If it is still blocked, open **System Settings -> Privacy & Security**
4. Find the blocked ForgeFlow launcher and choose **Open Anyway**

If you are comfortable with Terminal, you can also run this inside the unzipped folder:

```bash
xattr -dr com.apple.quarantine .
./start.command
```

### Windows

Double-click:

```text
Start ForgeFlow.bat
```

### Then open

```text
http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html
```
