@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\NormalMap Desktop.exe" "%~dp0material-batch.js" %*
