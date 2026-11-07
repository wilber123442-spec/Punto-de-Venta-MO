using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Punto de Venta MO")]
[assembly: AssemblyDescription("Instalador de Punto de Venta MO para Windows")]
[assembly: AssemblyCompany("Punto de Venta MO")]
[assembly: AssemblyProduct("Punto de Venta MO")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Installer
{
    private const string ProductName = "Punto de Venta MO";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PuntoDeVentaMO";
    private static string language = "es";
    private static string initialCurrency;
    private static bool firstInstall;

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
        using (Button continueButton = new Button())
        {
            form.Text = "Punto de Venta MO · Setup";
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.ClientSize = new System.Drawing.Size(470, firstInstall ? 250 : 155);
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
                "Nicaragua · Córdobas (NIO)", "Estados Unidos · Dólares (USD)",
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
            currencyChoices.Width = 425;
            currencyPrompt.Visible = firstInstall;
            currencyChoices.Visible = firstInstall;
            continueButton.Text = "Continuar / Continue / Continuar";
            continueButton.DialogResult = DialogResult.OK;
            continueButton.Location = new System.Drawing.Point(305, firstInstall ? 195 : 100);
            continueButton.Width = 142;
            form.Controls.Add(prompt);
            form.Controls.Add(choices);
            form.Controls.Add(currencyPrompt);
            form.Controls.Add(currencyChoices);
            form.Controls.Add(continueButton);
            form.AcceptButton = continueButton;
            if (form.ShowDialog() != DialogResult.OK) return null;
            if (firstInstall)
            {
                string[] currencyCodes = { "NIO", "USD", "MXN", "CRC", "HNL", "GTQ", "PAB", "COP", "ARS", "CLP", "PEN", "DOP", "BRL", "EUR", "CAD", "GBP" };
                initialCurrency = currencyCodes[currencyChoices.SelectedIndex];
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
                "¿Deseas instalar Punto de Venta MO en esta computadora? Reinstalar conserva los datos guardados localmente.",
                "Install Punto de Venta MO on this computer? Reinstalling keeps locally saved data.",
                "Deseja instalar o Ponto de Venda MO neste computador? Reinstalar preserva os dados salvos localmente."),
            Localized("Punto de Venta MO - Instalador", "Punto de Venta MO - Installer", "Ponto de Venda MO - Instalador"),
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);
        if (choice != DialogResult.Yes) return 0;

        try
        {
            InstallApplication();
            DialogResult openNow = MessageBox.Show(
                Localized(
                    "Punto de Venta MO quedó instalado.\n\n¿Quieres abrirlo ahora?",
                    "Punto de Venta MO is installed.\n\nWould you like to open it now?",
                    "O Ponto de Venda MO foi instalado.\n\nDeseja abri-lo agora?"),
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
            ProductName);
    }

    private static void InstallApplication()
    {
        string installDirectory = GetInstallDirectory();
        string localDataDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            ProductName);
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
            Direct