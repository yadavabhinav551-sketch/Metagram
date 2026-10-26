package com.calculator.app

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private var pendingContactsReply: JavaScriptReplyProxy? = null
    private var currentUrlIndex = 0
    private var urlsToTry = arrayOf(
        "http://127.0.0.1:3000",
        "http://10.0.2.2:3000"
    )

    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        val request = pendingWebPermissionRequest ?: return@registerForActivityResult
        pendingWebPermissionRequest = null
        val allGranted = request.resources.all { resource ->
            val permission = when (resource) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                else -> null
            }
            permission != null &&
                ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
        }
        if (allGranted) {
            request.grant(request.resources)
        } else {
            request.deny()
        }
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (filePathCallback == null) return@registerForActivityResult
        val results: Array<Uri>? = if (result.resultCode == RESULT_OK) {
            val intent = result.data
            if (intent?.data != null) {
                arrayOf(intent.data!!)
            } else if (intent?.clipData != null) {
                val clipData = intent.clipData!!
                Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
            } else null
        } else null

        filePathCallback?.onReceiveValue(results)
        filePathCallback = null
    }

    private val contactsPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            showDeviceContactPicker()
        } else {
            sendContactsResult("error", message = "Contacts permission was denied.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        webView = WebView(this)
        setContentView(webView)

        val configuredUrl = getString(R.string.server_url)
        if (configuredUrl.isNotEmpty()) {
            urlsToTry = arrayOf("http://127.0.0.1:3000", "http://10.0.2.2:3000", configuredUrl)
        }

        setupWebView()
        loadCurrentUrl()
    }

    private fun loadCurrentUrl() {
        if (currentUrlIndex < urlsToTry.size) {
            webView.loadUrl(urlsToTry[currentUrlIndex])
        }
    }

    private fun setupWebView() {
        webView.setBackgroundColor(android.graphics.Color.BLACK)
        
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.userAgentString = settings.userAgentString + " CalculatorAndroidApp"

        val trustedOrigins = urlsToTry.mapNotNull { rawUrl ->
            val uri = Uri.parse(rawUrl)
            if (uri.scheme == null || uri.authority == null) null else "${uri.scheme}://${uri.authority}"
        }.toSet()
        if (trustedOrigins.isNotEmpty() && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "AndroidContacts", trustedOrigins) { _, message, _, isMainFrame, replyProxy ->
                if (isMainFrame && message.data == "pick-contacts") {
                    runOnUiThread { requestDeviceContacts(replyProxy) }
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return false
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    currentUrlIndex = (currentUrlIndex + 1) % urlsToTry.size
                    Handler(Looper.getMainLooper()).postDelayed({
                        loadCurrentUrl()
                    }, 1000)
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val requiredPermissions = request.resources.mapNotNull { resource ->
                    when (resource) {
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                        else -> null
                    }
                }
                if (requiredPermissions.size != request.resources.size) {
                    request.deny()
                    return
                }
                val missingPermissions = requiredPermissions.distinct().filter {
                    ContextCompat.checkSelfPermission(this@MainActivity, it) != PackageManager.PERMISSION_GRANTED
                }
                if (missingPermissions.isEmpty()) {
                    request.grant(request.resources)
                    return
                }
                pendingWebPermissionRequest?.deny()
                pendingWebPermissionRequest = request
                requestPermissionsLauncher.launch(missingPermissions.toTypedArray())
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                if (pendingWebPermissionRequest == request) {
                    pendingWebPermissionRequest = null
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
                fileChooserLauncher.launch(Intent.createChooser(intent, "Select Attachment"))
                return true
            }
        }
    }

    private fun requestDeviceContacts(replyProxy: JavaScriptReplyProxy) {
        pendingContactsReply = replyProxy
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
            showDeviceContactPicker()
        } else {
            contactsPermissionLauncher.launch(Manifest.permission.READ_CONTACTS)
        }
    }

    private fun showDeviceContactPicker() {
        val contactsById = linkedMapOf<String, Pair<String, LinkedHashSet<String>>>()
        val cursor = try {
            contentResolver.query(
                ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Email.CONTACT_ID,
                    ContactsContract.CommonDataKinds.Email.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Email.ADDRESS
                ),
                null,
                null,
                "${ContactsContract.CommonDataKinds.Email.DISPLAY_NAME} ASC"
            )
        } catch (_: SecurityException) {
            sendContactsResult("error", message = "Contacts permission is required to search selected contacts.")
            return
        }
        if (cursor == null) {
            sendContactsResult("error", message = "Could not read device contacts.")
            return
        }

        cursor.use {
            val idColumn = it.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Email.CONTACT_ID)
            val nameColumn = it.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Email.DISPLAY_NAME)
            val emailColumn = it.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Email.ADDRESS)
            while (it.moveToNext()) {
                val email = it.getString(emailColumn)?.trim().orEmpty()
                if (!email.matches(Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"))) continue
                val contactId = it.getString(idColumn) ?: continue
                val displayName = it.getString(nameColumn)?.trim().takeUnless { name -> name.isNullOrEmpty() } ?: "Contact"
                val entry = contactsById.getOrPut(contactId) { displayName to linkedSetOf() }
                entry.second.add(email)
                if (contactsById.size >= 500) break
            }
        }

        if (contactsById.isEmpty()) {
            sendContactsResult("picked", contacts = emptyList())
            return
        }

        val contacts = contactsById.values.toList()
        val labels = contacts.map { (name, emails) -> "$name\n${emails.joinToString()}" }.toTypedArray()
        val checked = BooleanArray(contacts.size)
        AlertDialog.Builder(this)
            .setTitle("Choose contacts to check")
            .setMultiChoiceItems(labels, checked) { _, index, isChecked -> checked[index] = isChecked }
            .setPositiveButton("Check selected") { _, _ ->
                val selected = contacts.filterIndexed { index, _ -> checked[index] }
                sendContactsResult("picked", contacts = selected)
            }
            .setNegativeButton("Cancel") { _, _ -> sendContactsResult("cancelled") }
            .setOnCancelListener { sendContactsResult("cancelled") }
            .show()
    }

    private fun sendContactsResult(
        type: String,
        contacts: List<Pair<String, LinkedHashSet<String>>> = emptyList(),
        message: String? = null
    ) {
        val replyProxy = pendingContactsReply ?: return
        pendingContactsReply = null
        val payload = org.json.JSONObject().put("type", type)
        if (message != null) payload.put("message", message)
        if (type == "picked") {
            val selectedContacts = org.json.JSONArray()
            contacts.forEach { (name, emails) ->
                val emailArray = org.json.JSONArray()
                emails.forEach(emailArray::put)
                selectedContacts.put(org.json.JSONObject().put("name", name).put("emails", emailArray))
            }
            payload.put("contacts", selectedContacts)
        }
        replyProxy.postMessage(payload.toString())
    }

    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
