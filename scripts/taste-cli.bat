@echo off
setlocal enabledelayedexpansion

REM Set default image if not already set
if "%TASTE_DOCKER_IMAGE%"=="" (
    set "IMAGE=gitlab.esa.int:4567/taste/taste-setup:feature-trixie"
) else (
    set "IMAGE=%TASTE_DOCKER_IMAGE%"
)

set "CONTAINER_HOME=/home/taste"

REM Get current directory and convert to Unix-style path for container
set "WORKDIR=%CD%"
set "WORKDIR_UNIX=%WORKDIR:\=/%"
REM Convert drive letter (e.g., C: -> /c)
set "WORKDIR_UNIX=%WORKDIR_UNIX::=%"
set "DRIVE_LETTER=%WORKDIR_UNIX:~0,1%"
call :lowercase DRIVE_LETTER
set "WORKDIR_UNIX=/%DRIVE_LETTER%%WORKDIR_UNIX:~1%"

REM Check if podman is installed
where podman >nul 2>&1
if %errorlevel% neq 0 (
    echo [x] You don't have Podman installed. Aborting...
    exit /b 1
)

REM Set UID and GID (podman on Windows handles this differently, using defaults)
set "HOST_UID=1000"
set "HOST_GID=1000"

REM Build the podman command
set "PODMAN_CMD=podman"

REM Determine if we're in interactive mode (simplified for Windows)
REM In batch, we'll default to interactive mode unless running with arguments
set "TTY_ARGS=-it"

REM Build the container startup script
set "STARTUP_SCRIPT=mkdir -p $HOME; ln -sfn /home/taste/tool-inst $HOME/tool-inst; export PS1='taste-cli:\w\$ '; export TASTE_IN_DOCKER=1; export QT_QPA_PLATFORM=offscreen; export PYTHONUSERBASE=/home/taste/.local; [ -f /home/taste/.bashrc.taste ] && . /home/taste/.bashrc.taste; for compiler_dir in /opt/*/bin; do [ -d \"$compiler_dir\" ] || continue; case \":$PATH:\" in *\":$compiler_dir:\"*) ;; *) PATH=\"$compiler_dir:$PATH\" ;; esac; done; export PATH; if [ $# -eq 0 ] ; then exec bash -i; fi; \"$@\"; status=$?; exit $status"

REM Run podman container
%PODMAN_CMD% run ^
    --rm ^
    %TTY_ARGS% ^
    --user %HOST_UID%:%HOST_GID% ^
    -e APPIMAGE_EXTRACT_AND_RUN=1 ^
    -e HOME=/tmp/taste-home ^
    -e PYTHONUSERBASE=%CONTAINER_HOME%/.local ^
    -e USER=taste ^
    -e LOGNAME=taste ^
    -e TASTE_IN_DOCKER=1 ^
    -e TASTE_HOST_PWD=%WORKDIR_UNIX% ^
    -v "%WORKDIR%:%CONTAINER_HOME%/work" ^
    -w %CONTAINER_HOME%/work ^
    %IMAGE% ^
    bash -lc "%STARTUP_SCRIPT%" bash %*

exit /b %errorlevel%

:lowercase
REM Convert to lowercase (helper function)
set "%~1=!%~1:A=a!"
set "%~1=!%~1:B=b!"
set "%~1=!%~1:C=c!"
set "%~1=!%~1:D=d!"
set "%~1=!%~1:E=e!"
set "%~1=!%~1:F=f!"
set "%~1=!%~1:G=g!"
set "%~1=!%~1:H=h!"
set "%~1=!%~1:I=i!"
set "%~1=!%~1:J=j!"
set "%~1=!%~1:K=k!"
set "%~1=!%~1:L=l!"
set "%~1=!%~1:M=m!"
set "%~1=!%~1:N=n!"
set "%~1=!%~1:O=o!"
set "%~1=!%~1:P=p!"
set "%~1=!%~1:Q=q!"
set "%~1=!%~1:R=r!"
set "%~1=!%~1:S=s!"
set "%~1=!%~1:T=t!"
set "%~1=!%~1:U=u!"
set "%~1=!%~1:V=v!"
set "%~1=!%~1:W=w!"
set "%~1=!%~1:X=x!"
set "%~1=!%~1:Y=y!"
set "%~1=!%~1:Z=z!"
goto :eof
