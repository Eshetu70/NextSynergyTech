const request = {
    appId: '1367960761292807',
    appKey: 'YOUR_APP_KEY',
    outTradeNo: 'UNIQUE_TRANSACTION_ORDER_NUMBER',
    nonce: 'UNIQUE_RANDOM_STRING',
    subject: 'TRANSACTION_SUBJECT',
    shortCode: 'YOUR_SHORT_CODE',
    notifyUrl: 'YOUR_NOTIFY_URL', // Must be HTTPS
    returnUrl: 'YOUR_RETURN_URL', // Must be HTTPS
    receiveName: 'RECEIVER_COMPANY_NAME',
    timeoutExpress: 'TIMEOUT_IN_MINUTES', // e.g., '30'
    totalAmount: 'PAYMENT_AMOUNT',
    timestamp: `${Date.now()}`
  };