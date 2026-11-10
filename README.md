# Boreas

Boreas is a self-hosted media server for Windows.

Download BoreasSetup.exe from Releases. Install Node.js 20 or newer first. FFmpeg and FFprobe on PATH are needed for media analysis, remuxing, and transcoding. The setup program lets you choose a Data folder and optionally start Boreas in the tray at Windows sign-in. Open http://localhost:5180 to create the first administrator.

Sports and Live TV are off on a new install. Configure optional services in Server Settings before enabling them. Use an HTTPS reverse proxy for a public URL and add that origin in Server Settings → Networking.

Stable checks tagged releases. Experimental checks commits on the default branch and links to the matching Windows build when it is available. Download and run the installer to update. Exit the Boreas tray before updating. The installer preserves the server configuration and Data.

Build locally with `pwsh -File installer/Build.ps1`. The EXE is written to `installer/dist`.
