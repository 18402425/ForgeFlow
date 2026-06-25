# ForgeFlow Local Privacy

ForgeFlow Local is designed to run on your own computer.

## What Stays Local

- Imported orders
- SKU recipes
- Material inventory
- Equipment calendar
- Manual plan adjustments
- Event records
- AI provider settings

The browser stores most working data in localStorage. The local server stores prototype state in local files when needed.

## API Keys

If you enable the AI explanation layer, your API Key is saved in your own browser localStorage.

ForgeFlow does not run a cloud service. The local server only forwards the request from your computer to the provider you selected, currently OpenAI or DeepSeek.

Do not publish screenshots, bug reports, or exported backups that contain your API Key.

## What AI Can Do

AI only explains an already computed local plan. It does not create the production schedule and does not modify orders, inventory, or equipment.

## What To Remove Before Sharing

Before uploading a fork or sending a debug package, remove:

- `.env` files
- local state files
- SQLite files
- logs
- exported backups that may contain private order or API data
