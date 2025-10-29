'use strict'

/**
 * MailDev - routes.js
 */
const express = require('express')
const compression = require('compression')
const pkg = require('../package.json')
const { filterEmails } = require('./utils')

const emailRegexp = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/

module.exports = function (app, mailserver, basePathname) {
  const router = express.Router()

  router.use(express.urlencoded({ extended: true }));  

  // Middleware para verificar la sesión de filtrado  
  router.use(function(req, res, next) {  
    // Excluir rutas de API y recursos estáticos  
    if (req.path.startsWith('/email') && req.method === 'GET') {  
      // Obtener el filtro de la sesión o cookie  
      const filterFrom = req.session?.filterFrom || req.cookies?.filterFrom;  
        
      // Si hay un filtro y no está en la solicitud, agregarlo  
      if (filterFrom && !req.query['from']) {  
        // Clonar query y agregar filtro  
        const newQuery = {...req.query, 'from': filterFrom};  
        // Reconstruir URL con el nuevo query  
        const url = req.path + '?' + new URLSearchParams(newQuery).toString();  
        return res.redirect(url);  
      }  
    }  
    next();  
  });  
    
  // Ruta para la página de bienvenida y configuración del filtro  
  router.get('/welcome', function(req, res) {  
    res.sendFile(path.join(__dirname, '../app/welcome.html'));  
  });  
    
  // Ruta para establecer el filtro  
  router.post('/set-filter', function(req, res) {  
    const email = req.body.email;  
    if (req.session) req.session.filterFrom = email;  
    res.cookie('filterFrom', email, { maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 días
    res.redirect('/?from=' + encodeURIComponent(email));  
  });
  
  // Route to clear the filter
  router.post('/clear-filter', function(req, res) {  
    if (req.session) req.session.filterFrom = '';  
    res.clearCookie('filterFrom');
    return res.json({ success: true });
  });

  // Get all emails
  // Optional
  // - skip - number of email offset for pagination
  // - *any* - query using dot notation for any param, ex. from.address=hello@yes.com
  router.get('/email', compression(), function (req, res) {
    mailserver.getAllEmail(function (err, emailList) {
      if (err) return res.status(404).json([])
      const { skip, ...query } = req.query
      const skipCount = skip ? parseInt(skip, 10) : 0
      if (Object.keys(query).length) {
        const filteredEmails = filterEmails(emailList, query)
        console.log('Filtered Emails:', filteredEmails.length)
        res.json(filteredEmails.slice(skipCount))
      } else {
        res.json(emailList.slice(skipCount))
      }
    })
  })

  // Get single email
  router.get('/email/:id', function (req, res) {
    mailserver.getEmail(req.params.id, function (err, email) {
      if (err) return res.status(404).json({ error: err.message })

      email.read = true // Mark the email as 'read'

      res.json(email)
    })
  })

  // Read email
  // router.patch('/email/:id/read', function (req, res) {
  //  mailserver.readEmail(req.params.id, function (err, email) {
  //    if (err) return res.status(500).json({ error: err.message })
  //    res.json(true)
  //  })
  // })

  // Read all emails
  router.patch('/email/read-all', function (req, res) {
    mailserver.readAllEmail(function (err, count) {
      if (err) return res.status(500).json({ error: err.message })
      res.json(count)
    })
  })

  // Delete all emails
  router.delete('/email/all', function (req, res) {
    mailserver.deleteAllEmail(function (err) {
      if (err) return res.status(500).json({ error: err.message })

      res.json(true)
    })
  })

  // Delete email by id
  router.delete('/email/:id', function (req, res) {
    mailserver.deleteEmail(req.params.id, function (err) {
      if (err) return res.status(500).json({ error: err.message })

      res.json(true)
    })
  })

  // Get Email HTML
  router.get('/email/:id/html', function (req, res) {
    // Use the headers over hostname to include any port
    const baseUrl = req.headers.host + (req.baseUrl || '')

    mailserver.getEmailHTML(req.params.id, baseUrl, function (err, html) {
      if (err) return res.status(404).json({ error: err.message })

      res.send(html)
    })
  })

  // Serve Attachments
  router.get('/email/:id/attachment/:filename', function (req, res) {
    mailserver.getEmailAttachment(req.params.id, req.params.filename, function (err, contentType, readStream) {
      if (err) return res.status(404).json('File not found')

      res.contentType(contentType)
      readStream.pipe(res)
    })
  })

  // Serve email.eml
  router.get('/email/:id/download', function (req, res) {
    mailserver.getEmailEml(req.params.id, function (err, contentType, filename, readStream) {
      if (err) return res.status(404).json('File not found')

      res.setHeader('Content-disposition', 'attachment; filename=' + filename)
      res.contentType(contentType)
      readStream.pipe(res)
    })
  })

  // Get email source from .eml file
  router.get('/email/:id/source', function (req, res) {
    mailserver.getRawEmail(req.params.id, function (err, readStream) {
      if (err) return res.status(404).json('File not found')
      readStream.pipe(res)
    })
  })

  // Get any config settings for display
  router.get('/config', function (req, res) {
    res.json({
      version: pkg.version,
      smtpPort: mailserver.port,
      isOutgoingEnabled: mailserver.isOutgoingEnabled(),
      outgoingHost: mailserver.getOutgoingHost(),
      filterFrom: req.session?.filterFrom || req.cookies?.filterFrom || ''
    })
  })

  // Relay the email
  router.post('/email/:id/relay/:relayTo?', function (req, res) {
    mailserver.getEmail(req.params.id, function (err, email) {
      if (err) return res.status(404).json({ error: err.message })

      if (req.params.relayTo) {
        if (emailRegexp.test(req.params.relayTo)) {
          email.to = [{ address: req.params.relayTo }]
          email.envelope.to = [{ address: req.params.relayTo, args: false }]
        } else {
          return res.status(400).json({ error: 'Incorrect email address provided :' + req.params.relayTo })
        }
      }

      mailserver.relayMail(email, function (err) {
        if (err) return res.status(500).json({ error: err.message })

        res.json(true)
      })
    })
  })

  // Health check
  router.get('/healthz', function (req, res) {
    res.json(true)
  })

  router.get('/reloadMailsFromDirectory', function (req, res) {
    mailserver.loadMailsFromDirectory()
    res.json(true)
  })
  app.use(basePathname, router)
}
