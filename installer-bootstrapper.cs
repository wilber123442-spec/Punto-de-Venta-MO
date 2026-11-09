using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Mi Caja C$")]
[assembly: AssemblyDescription("Instalador de Mi Caja C$ para Windows")]
[assembly: AssemblyCompany("Mi Caja C$")]
[assembly: AssemblyProduct("Mi Caja C$")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Installer
{
    private const string ProductName = "Mi Caja C$";
    private const string InstallFolderName = "Punto de Venta MO";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PuntoDeVentaMO";
    private static string language = "es";
    private static string initialCurrency;
    private static bool firstInstall;
    private static string initialBusinessName;
    private static string initialAdminName;
    private static string initialAdminUsername;
    private static string initialAdminPassword;

    private static string Localized(string spanish, string english, string portuguese)
    {
        if (language == "en") return english;
        if (language == "pt") return portuguese;
        return spanish;
    }

    private static string ChooseLanguage()
    {
        using (Form form = new Form())
        using (Label prompt = new Label())
        using (ComboBox choices = new ComboBox())
        using (Label currencyPrompt = new Label())
        using (ComboBox currencyChoices = new ComboBox())
        using (Label businessPrompt = new Label())
        using (TextBox businessInput = new TextBox())
        using (Label adminNamePrompt = new Label())
        using (TextBox adminNameInput = new TextBox())
        using (Label adminUsernamePrompt = new Label())
        using (TextBox adminUsernameInput = new TextBox())
        using (Label adminPasswordPrompt = new Label())
        using (TextBox adminPasswordInput = new TextBox())
        using (Label accountPrivacyNote = new Label())
        using (Button continueButton = new Button())
        {
            form.Text = "Mi Caja C$ · Setup";
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.ClientSize = firstInstall ? new System.Drawing.Size(520, 500) : new System.Drawing.Size(470, 155);
            form.MaximizeBox = false;
            form.MinimizeBox = false;
            prompt.Text = "Idioma de instalación / Installer language / Idioma da instalação";
            prompt.AutoSize = true;
            prompt.Location = new System.Drawing.Point(20, 16);
            choices.DropDownStyle = ComboBoxStyle.DropDownList;
            choices.Items.AddRange(new object[] { "Español", "English", "Português" });
            choices.SelectedIndex = 0;
            choices.Location = new System.Drawing.Point(22, 42);
            choices.Width = 425;
            currencyPrompt.Text = "País y moneda / Country and currency / País e moeda";
            currencyPrompt.AutoSize = true;
            currencyPrompt.Location = new System.Drawing.Point(20, 88);
            currencyChoices.DropDownStyle = ComboBoxStyle.DropDownList;
            currencyChoices.Items.AddRange(new object[] {
                "Nicaragua · Córdobas (NIO)", "Estados Unidos · Dólares estadounidenses (USD)",
                "México · Pesos (MXN)", "Costa Rica · Colones (CRC)",
                "Honduras · Lempiras (HNL)", "Guatemala · Quetzales (GTQ)",
                "Panamá · Balboas (PAB)", "Colombia · Pesos (COP)",
                "Argentina · Pesos (ARS)", "Chile · Pesos (CLP)",
                "Perú · Soles (PEN)", "República Dominicana · Pesos (DOP)",
                "Brasil · Reales (BRL)", "Zona euro · Euros (EUR)",
                "Canadá · Dólares (CAD)", "Reino Unido · Libras (GBP)"
            });
            currencyChoices.SelectedIndex = 0;
            currencyChoices.Location = new System.Drawing.Point(22, 114);
            currencyChoices.Width = firstInstall ? 476 : 425;
            currencyPrompt.Visible = firstInstall;
            currencyChoices.Visible = firstInstall;
            businessPrompt.Text = "Nombre del negocio / Business name / Nome do negócio";
            businessPrompt.AutoSize = true;
            businessPrompt.Location = new System.Drawing.Point(22, 151);
            businessInput.Location = new System.Drawing.Point(22, 173);
            businessInput.Width = 476;
            adminNamePrompt.Text = "Nombre del administrador / Administrator name / Nome do administrador";
            adminNamePrompt.AutoSize = true;
            adminNamePrompt.Location = new System.Drawing.Point(22, 211);
            adminNameInput.Location = new System.Drawing.Point(22, 233);
            adminNameInput.Width = 476;
            adminUsernamePrompt.Text = "Usuario del administrador / Administrator username / Usuário do administrador";
            adminUsernamePrompt.AutoSize = true;
            adminUsernamePrompt.Location = new System.Drawing.Point(22, 271);
            adminUsernameInput.Location = new System.Drawing.Point(22, 293);
            adminUsernameInput.Width = 476;
            adminPasswordPrompt.Text = "Contraseña del administrador / Administrator password / Senha do administrador (mínimo 6 caracteres)";
            adminPasswordPrompt.AutoSize = true;
            adminPasswordPrompt.Location = new System.Drawing.Point(22, 331);
            adminPasswordInput.Location = new System.Drawing.Point(22, 353);
            adminPasswordInput.Width = 476;
            adminPasswordInput.UseSystemPasswordChar = true;
            accountPrivacyNote.Text = "Este negocio y su administrador serán propios de esta tienda. No se copian datos de otras instalaciones. / This store has its own administrator and data. / Esta loja terá administrador e dados próprios.";
            accountPrivacyNote.Location = new System.Drawing.Point(22, 388);
            accountPrivacyNote.Size = new System.Drawing.Size(476, 28);
            accountPrivacyNote.ForeColor = System.Drawing.Color.FromArgb(75, 85, 99);
            accountPrivacyNote.Visible = firstInstall;
            businessPrompt.Visible = businessInput.Visible = firstInstall;
            adminNamePrompt.Visible = adminNameInput.Visible = firstInstall;
            adminUsernamePrompt.Visible = adminUsernameInput.Visible = firstInstall;
            adminPasswordPrompt.Visible = adminPasswordInput.Visible = firstInstall;
            continueButton.Text = "Continuar / Continue / Continuar";
            continueButton.Location = new System.Drawing.Point(firstInstall ? 356 : 305, firstInstall ? 420 : 100);
            continueButton.Width = 142;
            continueButton.Click += (sender, args) =>
            {
                if (firstInstall && (String.IsNullOrWhiteSpace(businessInput.Text) ||
                    String.IsNullOrWhiteSpace(adminNameInput.Text) ||
                    String.IsNullOrWhiteSpace(adminUsernameInput.Text) || adminPasswordInput.Text.Length < 6))
                {
                    MessageBox.Show(form, "Completa los datos del negocio y del administrador. La contraseña debe tener al menos 6 caracteres.", ProductName, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                form.DialogResult = DialogResult.OK;
                form.Close();
            };
            form.Controls.Add(prompt);
            form.Controls.Add(choices);
            form.Controls.Add(currencyPrompt);
            form.Controls.Add(currencyChoices);
            form.Controls.Add(businessPrompt);
            form.Controls.Add(businessInput);
            form.Controls.Add(adminNamePrompt);
            form.Controls.Add(adminNameInput);
            form.Controls.Add(adminUsernamePrompt);
            form.Controls.Add(adminUsernameInput);
            form.Controls.Add(adminPasswordPrompt);
            form.Controls.Add(adminPasswordInput);
            form.Controls.Add(accountPrivacyNote);
            form.Controls.Add(continueButton);
            form.AcceptButton = continueButton;
            if (form.ShowDialog() != DialogResult.OK) return null;
            if (firstInstall)
            {
                string[] currencyCodes = { "NIO", "USD", "MXN", "CRC", "HNL", "GTQ", "PAB", "COP", "ARS", "CLP", "PEN", "DOP", "BRL", "EUR", "CAD", "GBP" };
                initialCurrency = currencyCodes[currencyChoices.SelectedIndex];
                initialBusinessName = businessInput.Text.Trim();
                initialAdminName = adminNameInput.Text.Trim();
                initialAdminUsername = adminUsernameInput.Text.Trim().ToLowerInvariant();
                initialAdminPassword = adminPasswordInput.Text;
            }
            return choices.SelectedIndex == 1 ? "en" : choices.SelectedIndex == 2 ? "pt" : "es";
        }
    }
    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        using (RegistryKey installed = Registry.CurrentUser.OpenSubKey(UninstallKey))
            firstInstall = installed == null;
        language = ChooseLanguage();
        if (language == null) return 0;

        DialogResult choice = MessageBox.Show(
            Localized(
                "¿Deseas instalar Mi Caja C$ en esta computadora? Reinstalar conserva los datos guardados localmente.",
                "Install Mi Caja C$ on this computer? Reinstalling keeps locally saved data.",
                "Deseja instalar o Mi Caja C$ neste computador? Reinstalar preserva os dados salvos localmente."),
            Localized("Mi Caja C$ - Instalador", "Mi Caja C$ - Installer", "Mi Caja C$ - Instalador"),
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);
        if (choice != DialogResult.Yes) return 0;

        try
        {
            InstallApplication();
            DialogResult openNow = MessageBox.Show(
                Localized(
                    "Mi Caja C$ quedó instalado.\n\n¿Quieres abrirlo ahora?",
                    "Mi Caja C$ is installed.\n\nWould you like to open it now?",
                    "O Mi Caja C$ foi instalado.\n\nDeseja abri-lo agora?"),
                Localized("Instalación completa", "Installation complete", "Instalação concluída"),
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Information);
            if (openNow == DialogResult.Yes)
            {
                string appExe = Path.Combine(GetInstallDirectory(), ProductName + ".exe");
                Process.Start(appExe);
            }
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                Localized("No se pudo completar la instalación.\n\n", "Installation could not be completed.\n\n", "Não foi possível concluir a instalação.\n\n") + ex.Message,
                Localized("Error de instalación", "Installation error", "Erro de instalação"),
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string GetInstallDirectory()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs",
            InstallFolderName);
    }

    private static void InstallApplication()
    {
        string installDirectory = GetInstallDirectory();
        string localDataDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            InstallFolderName);
        string tempDirectory = Path.Combine(Path.GetTempPath(), "PuntoDeVentaMO-" + Guid.NewGuid().ToString("N"));
        string archivePath = Path.Combine(tempDirectory, "app.zip");
        Directory.CreateDirectory(tempDirectory);

        try
        {
            using (Stream embeddedArchive = Assembly.GetExecutingAssembly().GetManifestResourceStream("APP_ARCHIVE"))
            {
                if (embeddedArchive == null) throw new InvalidOperationException("No se encontró el contenido del programa.");
                using (FileStream output = File.Create(archivePath)) embeddedArchive.CopyTo(output);
            }

            if (Directory.Exists(installDirectory)) Directory.Delete(installDirectory, true);
            Directory.CreateDirectory(installDirectory);
            ZipFile.ExtractToDirectory(archivePath, installDirectory);
            Directory.CreateDirectory(localDataDirectory);
            if (!String.IsNullOrEmpty(initialCurrency))
                File.WriteAllText(Path.Combine(localDataDirectory, "initial-currency.txt"), initialCurrency);
            if (firstInstall)
            {
                string[] values = {
                    initialBusinessName, initialAdminName, initialAdminUsername, initialAdminPassword
                };
                string encoded = String.Join(Environment.NewLine, Array.ConvertAll(values, value =>
                    Convert.ToBase64String(Encoding.UTF8.GetBytes(value))));
                File.WriteAllText(Path.Combine(localDataDirectory, "initial-admin.txt"), encoded, Encoding.UTF8);
            }
            WriteUninstaller(installDirectory);
            CreateShortcuts(installDirectory);
            RegisterApplication(installDirectory, localDataDirectory);
        }
        finally
        {
            try { Directory.Delete(tempDirectory, true); } catch { }
        }
    }

    private static void CreateShortcuts(string installDirectory)
    {
        string appExe = Path.Combine(installDirectory, ProductName + ".exe");
        string icon = Path.Combine(installDirectory, "resources", "mi-caja.ico");
        string startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
            "Programs",
            ProductName);
        string oldStartMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
            "Programs",
            InstallFolderName);
        try { Directory.Delete(oldStartMenu, true); } catch { }
        try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), InstallFolderName + ".lnk")); } catch { }
        Directory.CreateDirectory(startMenu);
        CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), ProductName + ".lnk"), appExe, installDirectory, icon);
        CreateShortcut(Path.Combine(startMenu, ProductName + ".lnk"), appExe, installDirectory, icon);
        string uninstaller = Path.Combine(installDirectory, "Desinstalar-Mi-Caja-C.ps1");
        CreateShortcut(
            Path.Combine(startMenu, "Desinstalar Mi Caja C$.lnk"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "powershell.exe"),
            installDirectory,
            icon,
            "-NoProfile -ExecutionPolicy Bypass -File \"" + uninstaller + "\"");
    }

    private static void CreateShortcut(string shortcutPath, string target, string workingDirectory, string icon, string arguments = null)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) throw new InvalidOperationException("Windows no pudo crear el acceso directo.");
        object shell = Activator.CreateInstance(shellType);
        object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
        Type shortcutType = shortcut.GetType();
        shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
        shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
        shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { icon });
        shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { ProductName });
        if (!String.IsNullOrEmpty(arguments))
            shortcutType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { arguments });
        shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut);
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
    }

    private static void RegisterApplication(string installDirectory, string localDataDirectory)
    {
        string appExe = Path.Combine(installDirectory, ProductName + ".exe");
        string uninstaller = Path.Combine(installDirectory, "Desinstalar-Mi-Caja-C.ps1");
        string uninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"" + uninstaller + "\"";
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", ProductName);
            key.SetValue("DisplayVersion", "1.0.7");
            key.SetValue("Publisher", ProductName);
            key.SetValue("InstallLocation", installDirectory);
            key.SetValue("DisplayIcon", appExe + ",0");
            key.SetValue("UninstallString", uninstallCommand);
            key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            key.SetValue("URLInfoAbout", "https://github.com/wilber123442-spec/Punto-de-Venta-MO");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            key.SetValue("EstimatedSize", 360000, RegistryValueKind.DWord);
        }
    }

    private static void WriteUninstaller(string installDirectory)
    {
        string script = @"$ErrorActionPreference = 'SilentlyContinue'
$confirm = [System.Windows.Forms.MessageBox]::Show('¿Quieres desinstalar Mi Caja C$? Los datos guardados se conservarán, a menos que elijas borrarlos en el siguiente paso.', 'Desinstalar Mi Caja C$', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question, [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { exit }
$removeData = [System.Windows.Forms.MessageBox]::Show('¿También deseas borrar los productos, ventas y configuración guardados en esta computadora?', 'Datos guardados', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning, [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
$programDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startPrograms = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
$startMenu = Join-Path $startPrograms 'Mi Caja C$'
$oldStartMenu = Join-Path $startPrograms 'Punto de Venta MO'
Stop-Process -Name 'Mi Caja C$' -Force
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Mi Caja C$.lnk') -Force
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Punto de Venta MO.lnk') -Force
Remove-Item -LiteralPath $startMenu -Recurse -Force
Remove-Item -LiteralPath $oldStartMenu -Recurse -Force
Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PuntoDeVentaMO' -Recurse -Force
if ($removeData -eq [System.Windows.Forms.DialogResult]::Yes) { Remove-Item -LiteralPath (Join-Path $env:LOCALAPPDATA 'Punto de Venta MO') -Recurse -Force }
Set-Location $env:TEMP
Start-Process -FilePath $env:ComSpec -WindowStyle Hidden -ArgumentList @('/c', 'timeout /t 2 /nobreak >nul & rmdir /s /q ""' + $programDir + '""')
";
        script = "Add-Type -AssemblyName System.Windows.Forms`r`n" + script;
        File.WriteAllText(Path.Combine(installDirectory, "Desinstalar-Mi-Caja-C.ps1"), script);
    }
}

