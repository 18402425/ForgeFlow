# ForgeFlow Local - Start Here

## 中文

解压后，先看这里。

ForgeFlow Local 是一个“本地网页工具”，不是会安装到桌面的传统 App。

它的使用方式是：

1. 双击启动文件
2. 启动文件会在你的电脑上运行本地服务
3. 浏览器会打开本机地址 `127.0.0.1`
4. 你在浏览器里使用 ForgeFlow

`127.0.0.1` 不是互联网网站，也不需要登录账号；它只代表你自己的电脑。

解压后的文件夹里，普通用户只需要看这些：

```text
Start ForgeFlow.command  Mac 启动
Start ForgeFlow.bat      Windows 启动
START_HERE.md            使用说明
templates/               空白模板
sample-data/             测试数据
app/                     程序文件，平时不用打开
```

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
./Start\ ForgeFlow.command
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

ForgeFlow Local is a local web app, not a traditional desktop app installed to your Desktop.

How it works:

1. Double-click the launcher
2. The launcher starts a local service on your computer
3. Your browser opens a `127.0.0.1` address
4. You use ForgeFlow in the browser

`127.0.0.1` is not an internet website and does not require login. It means your own computer.

Most users only need these files:

```text
Start ForgeFlow.command  Mac launcher
Start ForgeFlow.bat      Windows launcher
START_HERE.md            instructions
templates/               blank templates
sample-data/             test data
app/                     program files, usually no need to open
```

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
./Start\ ForgeFlow.command
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
