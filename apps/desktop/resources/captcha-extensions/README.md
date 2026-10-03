# CAPTCHA extension assets

PAGE-AUTO loads one managed unpacked CAPTCHA extension into the account browser during the login/session bootstrap only.

Expected packaged/dev layout:

```text
captcha-extensions/
  omocaptcha/
    manifest.json
  ezcaptcha/
    manifest.json
  2captcha/
    manifest.json
```

The provider directories must contain the official unpacked extension files. API keys are not stored in this folder and must never be committed here.

This integration does not change Group/Post Wall posting logic. The browser profile worker loads/configures the selected extension before Facebook login/session bootstrap, then the existing session gate decides whether login is complete, 2FA is required, or checkpoint/manual verification is required.
