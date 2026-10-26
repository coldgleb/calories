// Schema for the multi-user server.
//
// - users: open self-registration with email + password, no email verification.
//   `role` is "user" or "admin"; only a superuser (PocketBase dashboard) can change it.
// - foods: products and ready food shared by everybody. Anyone signed in adds,
//   only the author or an admin edits and deletes.
// - recipes, entries, weights, settings: personal, visible to the owner only.
//
// Every synced record carries the client's `uid` and `clientUpdatedAt` (ms), and is
// deleted softly (`deleted`) so that other devices learn about deletions.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    users.fields.add(new SelectField({ name: 'role', values: ['user', 'admin'], maxSelect: 1 }))
    // Users must not grant themselves the admin role.
    users.createRule = '@request.body.role:isset = false || @request.body.role = "user"'
    users.updateRule = 'id = @request.auth.id && @request.body.role:isset = false'
    users.fields.getByName('password').min = 8
    app.save(users)

    const signedIn = '@request.auth.id != ""'
    const authorOrAdmin = '(author = @request.auth.id || @request.auth.role = "admin")'
    const keepAuthor = '(@request.body.author:isset = false || @request.body.author = author)'

    const syncFields = () => [
      { name: 'uid', type: 'text', required: true, max: 64 },
      { name: 'clientUpdatedAt', type: 'number', onlyInt: true },
      { name: 'deleted', type: 'bool' },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ]
    const nutrition = () => [
      { name: 'kcal', type: 'number', min: 0 },
      { name: 'protein', type: 'number', min: 0 },
      { name: 'fat', type: 'number', min: 0 },
      { name: 'carbs', type: 'number', min: 0 },
    ]

    app.save(
      new Collection({
        type: 'base',
        name: 'foods',
        listRule: signedIn,
        viewRule: signedIn,
        createRule: `${signedIn} && author = @request.auth.id`,
        updateRule: `${authorOrAdmin} && ${keepAuthor}`,
        deleteRule: authorOrAdmin,
        fields: [
          ...syncFields(),
          { name: 'author', type: 'relation', collectionId: users.id, maxSelect: 1, required: true },
          { name: 'kind', type: 'select', values: ['product', 'ready'], maxSelect: 1, required: true },
          { name: 'name', type: 'text', required: true, max: 200 },
          ...nutrition(),
          { name: 'barcode', type: 'text', max: 32 },
          { name: 'portionGrams', type: 'number', min: 0 },
          { name: 'portionOnly', type: 'bool' },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_foods_uid ON foods (uid)',
          'CREATE INDEX idx_foods_updated ON foods (updated)',
          'CREATE INDEX idx_foods_barcode ON foods (barcode)',
        ],
      }),
    )

    // Personal collections: everything is limited to the owner, who can't hand records to others.
    const personal = (name, fields) => {
      const own = 'owner = @request.auth.id'
      app.save(
        new Collection({
          type: 'base',
          name,
          listRule: own,
          viewRule: own,
          createRule: `${signedIn} && ${own}`,
          updateRule: `${own} && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)`,
          deleteRule: own,
          fields: [
            ...syncFields(),
            { name: 'owner', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
            ...fields,
          ],
          indexes: [
            `CREATE UNIQUE INDEX idx_${name}_owner_uid ON ${name} (owner, uid)`,
            `CREATE INDEX idx_${name}_owner_updated ON ${name} (owner, updated)`,
          ],
        }),
      )
    }

    personal('recipes', [
      { name: 'name', type: 'text', required: true, max: 200 },
      // The recipe is offered in search as a food with this uid.
      { name: 'productUid', type: 'text', required: true, max: 64 },
      // [{ uid, grams }] — uids of foods or of other recipes' products.
      { name: 'ingredients', type: 'json', maxSize: 200000 },
      { name: 'cookedWeight', type: 'number', min: 0 },
      { name: 'portions', type: 'number', min: 0 },
    ])

    personal('entries', [
      { name: 'date', type: 'text', required: true, max: 10 },
      { name: 'foodUid', type: 'text', max: 64 },
      { name: 'name', type: 'text', required: true, max: 200 },
      { name: 'per100g', type: 'json', maxSize: 2000 },
      { name: 'grams', type: 'number', min: 0 },
      { name: 'portions', type: 'number', min: 0 },
      { name: 'portionGrams', type: 'number', min: 0 },
      { name: 'portionOnly', type: 'bool' },
      { name: 'createdAt', type: 'number', onlyInt: true },
    ])

    personal('weights', [
      { name: 'date', type: 'text', required: true, max: 10 },
      { name: 'weightKg', type: 'number', min: 0 },
    ])

    personal('settings', [
      { name: 'profile', type: 'json', maxSize: 5000 },
      { name: 'override', type: 'json', maxSize: 2000 },
    ])

    const settings = app.settings()
    settings.meta.appName = 'Калории'
    // Open registration on a public address: keep request rate limiting on.
    settings.rateLimits.enabled = true
    // Sync uploads records in batches of up to 50 upserts per request.
    settings.batch.enabled = true
    settings.batch.maxRequests = 50
    app.save(settings)
  },
  (app) => {
    for (const name of ['settings', 'weights', 'entries', 'recipes', 'foods']) {
      app.delete(app.findCollectionByNameOrId(name))
    }
    const users = app.findCollectionByNameOrId('users')
    users.fields.removeByName('role')
    app.save(users)
  },
)
