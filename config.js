/* Property Administration – settings for the browser (OneDrive) version.
 *
 * clientId: the "Application (client) ID" of your app registration in the Microsoft Entra admin center
 *           (see SETUP-ONEDRIVE.md). Leave empty until the registration exists.
 * authority: "https://login.microsoftonline.com/consumers" for a personal Microsoft account (OneDrive personal),
 *            "https://login.microsoftonline.com/common" if the registration also allows work/school accounts.
 * defaultDataFolder: OneDrive folder that contains property.db (path relative to the OneDrive root).
 *                    Can be changed in the app under Data Admin → Settings.
 * rentControlFile:   OneDrive path of "Rent Control.xlsx" (read only). Can be changed under Data Admin → Settings.
 */
window.PA_CONFIG = {
  clientId: "46fadfd4-75ad-43da-a0a3-4de075944ba4",
  authority: "https://login.microsoftonline.com/consumers",
  defaultDataFolder: "01_Private/01 Immobilien/Immobilienverwaltung/PropertyAdministration/data",
  // Excel file with paid / outstanding rents – read on start when it has changed (never written)
  rentControlFile: "01_Private/01 Immobilien/Immobilienverwaltung/Rent Control.xlsx",
};
