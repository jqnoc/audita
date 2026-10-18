Option Explicit

' Audita.vbs - Launch Audita without showing a console window
Dim fso, wshShell, projectDir, npmCommand, commandLine, exitCode
Set fso = CreateObject("Scripting.FileSystemObject")
Set wshShell = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
wshShell.CurrentDirectory = projectDir

If Not fso.FileExists(fso.BuildPath(projectDir, "package.json")) Then
    MsgBox "Audita could not start because package.json was not found in:" & vbCrLf & _
        projectDir, vbCritical, "Audita"
    WScript.Quit 1
End If

If Not fso.FileExists(fso.BuildPath(projectDir, "node_modules\electron\package.json")) Then
    MsgBox "Audita's Node.js dependencies are not installed yet." & vbCrLf & vbCrLf & _
        "Open a terminal in:" & vbCrLf & projectDir & vbCrLf & vbCrLf & _
        "Then run:" & vbCrLf & "npm.cmd install", vbExclamation, "Audita"
    WScript.Quit 1
End If

npmCommand = FindNpmCommand(fso, wshShell)
If npmCommand = "" Then
    MsgBox "Audita could not find npm.cmd." & vbCrLf & vbCrLf & _
        "Install Node.js 18 or later, then try again.", vbCritical, "Audita"
    WScript.Quit 1
End If

' Call the batch file explicitly so paths such as "C:\Program Files\..." work.
commandLine = "cmd.exe /d /c call " & Chr(34) & npmCommand & Chr(34) & " start"
exitCode = wshShell.Run(commandLine, 0, True)

If exitCode <> 0 Then
    MsgBox "Audita could not start." & vbCrLf & vbCrLf & _
        "npm exited with code " & exitCode & "." & vbCrLf & _
        "Run npm.cmd start in a terminal for the full error.", vbCritical, "Audita"
End If

Function FindNpmCommand(fileSystem, shell)
    Dim candidates, candidate, pathValue, pathEntries, pathEntry
    candidates = Array( _
        shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\npm.cmd", _
        shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\nodejs\npm.cmd", _
        shell.ExpandEnvironmentStrings("%APPDATA%") & "\npm\npm.cmd" _
    )

    For Each candidate In candidates
        If fileSystem.FileExists(candidate) Then
            FindNpmCommand = candidate
            Exit Function
        End If
    Next

    pathValue = shell.Environment("PROCESS")("Path")
    pathEntries = Split(pathValue, ";")
    For Each pathEntry In pathEntries
        pathEntry = Replace(Trim(pathEntry), Chr(34), "")
        If Len(pathEntry) > 0 Then
            candidate = fileSystem.BuildPath(pathEntry, "npm.cmd")
            If fileSystem.FileExists(candidate) Then
                FindNpmCommand = candidate
                Exit Function
            End If
        End If
    Next

    FindNpmCommand = ""
End Function
