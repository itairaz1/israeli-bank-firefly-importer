# Israeli Bank Firefly iii Importer
This project is in early stage! Please feel free to share your ideas and thoughts by creating an [issue](https://github.com/itairaz1/israeli-bank-firefly-importer/issues/new).

Using [Israeli bank scrapper](https://github.com/eshaham/israeli-bank-scrapers) and import the data into free and open source [Firefly iii](https://www.firefly-iii.org/). All this solution is for local installation (self-hosted), so you are not coupled with SaaS provider, but you will have to make sure your host is secured (On your own risk!).

## Features
1. Import all the transactions from your israeli bank site and israeli credit-cards sites into firefly iii.
2. Every run imports only the missing transactions.
3. Locate credit-card end-of-period transactions in your bank account, and change it to transfer transaction to the correct credit-card inorder to keep credit-card balance correct.
4. Optionally periodically running using CRON. 

## Installing
### Prerequisite
1. [Firefly iii](https://www.firefly-iii.org/) is required in order to import data into - [getting started](https://github.com/firefly-iii/firefly-iii#getting-started).
2. Dedicated host (server) to install Firefly iii and this importer.
3. Supported accounts (Banks and credit-cards): [currently supported](#supported-accounts).
4. You will have to provide usernames and passwords for your accounts (Locally), so make sure your host is secured.

### Steps (Quick start)
1. Run `npm install -g israeli-bank-firefly-importer`.
2. Create API Token in firefly iii by - 
   1. Go to your hosted Firefly iii user interface.
   2. Click on 'Options' on the left.
   3. Click on 'Profile' in the sub menu.
   4. Click on 'OAuth' tab.
   5. Under 'Personal Access Tokens' click on 'Create new token'.
   6. Give a name and click create.
   7. Keep the token for later stage.
3. Copy [config template](config/basic.template.config.yaml) to working directory, change the name to `config.yaml` and edit it based on the comments
   ```shell
   wget https://raw.githubusercontent.com/itairaz1/israeli-bank-firefly-importer/main/config/basic.template.config.yaml
   mv basic.template.config.yaml config.yaml
   vi config.yaml
   ```
4. Start by running `israeli-bank-firefly-importer` in your terminal.

### Using docker
You can build docker using following command:
```shell
docker build image-name:tag
```
Or you can just use the official docker `itair86/israel-bank-firefly-importer` and run it by the following command:
```shell
docker run -v path-to/config.yaml:/home/pptruser/app/config.yaml itair86/israel-bank-firefly-importer:latest
```
While `path-to/config.yaml` is path to your config file (See [installing steps](#steps-quick-start), step #3)

### Using Home Assistant
Check [israeli-bank-firefly-importer-hass-addon](https://github.com/itairaz1/israeli-bank-firefly-importer-hass-addon) repository.

## Schedule
If you want to let `israeli-bank-firefly-importer` running recurrently, you can set [cron expression](https://crontab.guru/) in `CRON` environment variable.

## Supported accounts
### Supported and tested accounts
1. Leumi
2. Isracard
3. Cal
4. Max

### Supported by [Israeli bank scrapper](https://github.com/eshaham/israeli-bank-scrapers) but not yet tested ([Report an issue](https://github.com/itairaz1/israeli-bank-firefly-importer/issues/new))
[Support list](https://github.com/eshaham/israeli-bank-scrapers#whats-here)

## Changing settings
The accounts and transactions that created are being created with some details and settings that you can change. For example, you can remove `Include in net worth` from credit card accounts, if you wish. There are some details that you don't want to change, since this importer is using them in order to keep track:
1. Account's number.
2. Transaction's Tags.
3. If exists, transaction's External ID.
4. If transaction's External ID not exists - All transactions settings shouldn't be change except budget.

## Missing features and known issues
1. Test all banks and credit cards.
2. Code quality: Add tests, error handling, organize code and more.
3. Consider use typescript.
4. Support changing config after first run.
5. Support multi banks.
6. Make it more CLI friendly.
7. Refund is not getting deleted.

## Report a bug
To report a bug please [create an issue](https://github.com/itairaz1/israeli-bank-firefly-importer/issues/new) with the following details:
1. Detailed bug description
2. Israel Bank Firefly Importer version
3. Firefly iii version
4. Operating system
5. Installation type (Native / Docker / HA addon)
6. Sensitized debug log - example of how to turn on debug logs [here](https://github.com/itairaz1/israeli-bank-firefly-importer/blob/main/config/example.yaml#L34). Make sure you going through the logs and remove any sensitive data.

## License
[MIT License](LICENSE)
