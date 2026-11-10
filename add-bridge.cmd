@echo off
chcp 65001 >nul
setlocal
rem Wallpaper Engine 插件 —— 手动把渲染桥打回 Twilight Echo 的 app.asar
rem 用法：双击；或 add-bridge.cmd "D:\TwilightEcho"

set "APP_DIR=%~1"
if "%APP_DIR%"=="" set "APP_DIR=D:\TwilightEcho"

if not exist "%APP_DIR%\resources\app.asar" (
  echo [错误] 找不到 %APP_DIR%\resources\app.asar
  echo        请把 Twilight Echo 安装目录作为参数传入，例如：
  echo        add-bridge.cmd "D:\TwilightEcho"
  goto :end
)

set "NODE_EXE=%APP_DIR%\resources\core-node\runtime\node.exe"
if not exist "%NODE_EXE%" (
  echo [错误] 找不到 %NODE_EXE%
  echo        需要 Twilight Echo 2.0+（自带 core-node 运行时）。
  goto :end
)

set "ADAPTER=%~dp0lib\bridge-adapt.mjs"
if not exist "%ADAPTER%" (
  echo [错误] 找不到 %ADAPTER%
  echo        请在插件仓库根目录运行本脚本。
  goto :end
)

echo [1/3] 关闭中的应用会被要求先退出：如果 Twilight Echo 还在运行，请先完全退出（含托盘）。
echo [2/3] 使用 %NODE_EXE%
echo [3/3] 开始打桥补丁：%APP_DIR%
echo.

"%NODE_EXE%" "%ADAPTER%" --app "%APP_DIR%"
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (
  echo [完成] 桥已写回，重新启动 Twilight Echo，打开 设置 - 外观 - 动态壁纸 查看。
) else (
  echo [失败] 退出码 %CODE%，请把上面的输出发给作者。
)

:end
echo.
pause
endlocal
