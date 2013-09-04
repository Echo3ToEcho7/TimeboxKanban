(function() {
    var Ext = window.Ext4 || window.Ext;

    Ext.define('KanbanApp', {
        extend: 'Rally.app.App',
        requires: [
            'Rally.apps.kanban.Settings',
            'Rally.apps.kanban.Column',
            'Rally.ui.gridboard.GridBoard',
            'Rally.ui.gridboard.plugin.GridBoardAddNew',
            'Rally.ui.gridboard.plugin.GridBoardTagFilter',
            'Rally.ui.gridboard.plugin.GridBoardArtifactTypeChooser',
            'Rally.ui.cardboard.KanbanPolicy',
            'Rally.ui.cardboard.CardBoard',
            'Rally.ui.cardboard.plugin.Scrollable',
            'Rally.ui.report.StandardReport',
            'Rally.ui.tooltip.FilterInfo'
        ],
        cls: 'kanban',
        alias: 'widget.kanbanapp',
        appName: 'Kanban',

        settingsScope: 'project',

        items: [
            {
                xtype: 'container',
                itemId: 'bodyContainer'
            }
        ],

        config: {
            defaultSettings: {
                groupByField: 'ScheduleState',
                columns: Ext.JSON.encode({
                    Defined: {wip: ''},
                    'In-Progress': {wip: ''},
                    Completed: {wip: ''},
                    Accepted: {wip: ''}
                }),
                cardFields: 'Name,Discussion,Tasks,Defects',
                hideReleasedCards: false,
                showCardAge: true,
                cardAgeThreshold: 3,
                pageSize: 25
            }
        },

        launch: function() {
            this.setLoading();

            Rally.data.ModelFactory.getModel({
                type: 'UserStory',
                success: this._onStoryModelRetrieved,
                scope: this
            });
        },

        getOptions: function() {
            return [
                {
                    text: 'Show Cycle Time Report',
                    handler: this._showCycleTimeReport,
                    scope: this
                },
                {
                    text: 'Show Throughput Report',
                    handler: this._showThroughputReport,
                    scope: this
                },
                {
                    text: 'Print',
                    handler: this._print,
                    scope: this
                }
            ];
        },

        getSettingsFields: function() {
            return Rally.apps.kanban.Settings.getFields();
        },

        _onStoryModelRetrieved: function(model) {
            this.groupByField = model.getField(this.getSetting('groupByField'));
            this.timeboxScope = this.getContext().getTimeboxScope();
            this._addCardboardContent();
        },

        _addCardboardContent: function() {
            var cardboardConfig = this._getCardboardConfig();

            var columnSetting = this._getColumnSetting();
            if (columnSetting) {
                cardboardConfig.columns = this._getColumnConfig(columnSetting);
            }

            this.gridboard = this.down('#bodyContainer').add(this._getGridboardConfig(cardboardConfig));

            this.cardboard = this.gridboard.getGridOrBoard();
        },

        _getGridboardConfig: function (cardboardConfig) {
            return {
                xtype: 'rallygridboard',
                cardBoardConfig: cardboardConfig,
                plugins: [
                    'rallygridboardaddnew',
                    {
                        ptype: 'rallygridboardartifacttypechooser',
                        artifactTypePreferenceKey: 'kanbanapp.rallygridboardartifacttypechooser',
                        additionalTypesConfig: [this._getAgreementsTypeConfig()]
                    },
                    'rallygridboardtagfilter'
                ],
                context: this.getContext(),
                modelNames: this._getDefaultTypes(),
                addNewPluginConfig: {
                    listeners: {
                        beforecreate: this._onBeforeCreate,
                        beforeeditorshow: this._onBeforeEditorShow,
                        create: this._onCreate,
                        scope: this
                    }
                },
                listeners: {
                    afterrender: this._onGridBoardAfterRender,
                    scope: this
                }
            };
        },

        _onGridBoardAfterRender: function(gridBoard) {
            gridBoard.getHeader().getRight().add({
                xtype: 'rallyfilterinfo',
                projectName: this.getSetting('project') && this.getContext().getProject().Name || 'Following Global Project Setting',
                scopeUp: this.getSetting('projectScopeUp'),
                scopeDown: this.getSetting('projectScopeDown'),
                query: this.getSetting('query')
            });

            this._showDnDRankWarning();
        },

        _getColumnConfig: function(columnSetting) {
            var columns = [];
            Ext.Object.each(columnSetting, function(column, values) {
                var columnName = column || 'None';
                var policyPrefKey = this.getSetting('groupByField') + columnName + 'Policy';
                //Early versions of the board did not correctly scope policy prefs
                //resulting in bleed across groupByField changes
                var policy = this.getSetting(policyPrefKey) || this.getSetting(columnName + 'Policy');

                var prefConfig = {
                    appID: this.getAppId(),
                    project: this.getContext().getProject(),
                    settings: {}
                };
                prefConfig.settings[policyPrefKey] = policy;

                var columnConfig = {
                    xtype: 'kanbancolumn',
                    wipLimit: values.wip,
                    value: column,
                    columnHeaderConfig: {
                        headerTpl: columnName
                    },
                    cardLimit: 100,
                    policyCmpConfig: {
                        xtype: 'rallykanbanpolicy',
                        policies: policy,
                        prefConfig: prefConfig,
                        title: 'Exit Agreement'
                    },
                    listeners: {
                        invalidfilter: {
                            fn: this._onInvalidFilter,
                            scope: this
                        }
                    }
                };
                columns.push(columnConfig);
            }, this);

            columns[columns.length - 1].storeConfig = {
                filters: this._getLastColumnFilter()
            };

            return columns;
        },

        _onInvalidFilter: function() {
            Rally.ui.notify.Notifier.showError({
                message: 'Invalid query: ' + this.getSetting('query')
            });
        },

        onTimeboxScopeChange: function(timeboxScope) {
            //this.callParent(arguments); // Bug?

            this.timeboxScope = timeboxScope;
            this.setLoading();
            this.down("#bodyContainer").removeAll(true);

            this._addCardboardContent();
        },

        _getCardboardFilter: function () {
            var filters;
            var timeboxContext = this.timeboxScope; //this.getContext().getTimeboxScope();
            var timeboxFilter = null;

            if (timeboxContext) {
              timeboxFilter = timeboxContext.getQueryFilter();
            }

            if (this.getSetting('query')) {
              filters = Rally.data.QueryFilter.fromQueryString(this.getSetting('query'));
              if (timeboxFilter) {
                filters = filters.and(timeboxFilter);
              }
            } else {
              filters = timeboxFilter;
            }

            return filters;
        },

        _getCardboardConfig: function() {
            var filters = this._getCardboardFilter();

            return {
                xtype: 'rallycardboard',
                plugins: [
                    {ptype: 'rallycardboardprinting', pluginId: 'print'},
                    {
                        ptype: 'rallyscrollablecardboard',
                        containerEl: this.getEl(),
                        getFirstVisibleScrollableColumn: function() {
                            return this.cmp.getVisibleColumns()[0];
                        },
                        getLastVisibleScrollableColumn: function() {
                            return Rally.util.Array.last(this.cmp.getVisibleColumns());
                        },
                        getScrollableColumns: function() {
                            return this.cmp.getColumns();
                        }
                    }
                ],
                types: this._getDefaultTypes(),
                attribute: this.getSetting('groupByField'),
                margin: '10px',
                context: this.getContext(),
                listeners: {
                    beforecarddroppedsave: this._onBeforeCardSaved,
                    load: this._onBoardLoad,
                    cardupdated: this._publishContentUpdatedNoDashboardLayout,
                    cardcopied: this._onCardCopied,
                    scope: this
                },
                columnConfig: {
                    xtype: 'rallykanbancolumn',
                    enablePolicies: true
                },
                cardConfig: {
                    editable: true,
                    showIconMenus: true,
                    fields: this.getSetting('cardFields').split(','),
                    showAge: this.getSetting('showCardAge') ? this.getSetting('cardAgeThreshold') : -1
                },
                loadMask: false,
                storeConfig: {
                    context: this.getContext().getDataContext(),
                    pageSize: this.getSetting('pageSize'),
                    filters: filters ? [filters] : []
                }
            };
        },

        _getLastColumnFilter: function() {
            return this.getSetting('hideReleasedCards') ?
                [
                    {
                        property: 'Release',
                        value: null
                    }
                ] : [];
        },

        _getColumnSetting: function() {
            var columnSetting = this.getSetting('columns');
            return columnSetting && Ext.JSON.decode(columnSetting);
        },

        _buildReportConfig: function(report) {
            var shownTypes = this._getShownTypes();
            var workItems = shownTypes.length === 2 ? 'N' : shownTypes[0].workItemType;

            var reportConfig = {
                report: report,
                work_items: workItems
            };
            if (this.getSetting('groupByField') !== 'ScheduleState') {
                reportConfig.filter_field = this.groupByField.displayName;
            }
            return reportConfig;
        },

        _showCycleTimeReport: function() {
            this._showReportDialog('Cycle Time Report',
                this._buildReportConfig(Rally.ui.report.StandardReport.Reports.CycleLeadTime));
        },

        _showThroughputReport: function() {
            this._showReportDialog('Throughput Report',
                this._buildReportConfig(Rally.ui.report.StandardReport.Reports.Throughput));
        },

        _print: function() {
            this.cardboard.openPrintPage({title: 'Kanban Board'});
        },

        _getShownTypes: function() {
            return this.gridboard.artifactTypeChooserPlugin.getChosenTypesConfig();
        },

        _getDefaultTypes: function() {
            return ['User Story', 'Defect'];
        },

        _buildStandardReportConfig: function(reportConfig) {
            var scope = this.getContext().getDataContext();
            return {
                xtype: 'rallystandardreport',
                padding: 10,
                project: scope.project,
                projectScopeUp: scope.projectScopeUp,
                projectScopeDown: scope.projectScopeDown,
                reportConfig: reportConfig
            };
        },

        _showReportDialog: function(title, reportConfig) {
            var height = 450, width = 600;
            this.getEl().mask();
            Ext.create('Rally.ui.dialog.Dialog', {
                title: title,
                autoShow: true,
                draggable: false,
                closable: true,
                modal: false,
                height: height,
                width: width,
                items: [
                    Ext.apply(this._buildStandardReportConfig(reportConfig),
                        {
                            height: height,
                            width: width
                        })
                ],
                listeners: {
                    close: function() {
                        this.getEl().unmask();
                    },
                    scope: this
                }
            }).alignTo(this.getEl(), 'c-c');
        },

        _onBoardLoad: function() {
            this._publishContentUpdated();
            this.setLoading(false);
            this._initializeChosenTypes();
        },

        _initializeChosenTypes: function() {
            var artifactsPref = this.gridboard.artifactTypeChooserPlugin.artifactsPref;
            var allowedArtifacts = this.gridboard.getHeader().getRight().query('checkboxfield');
            if (!Ext.isEmpty(artifactsPref) && artifactsPref.length !== allowedArtifacts.length) {
                this.gridboard.getGridOrBoard().addLocalFilter('ByType', artifactsPref, false);
            }
            if (Ext.Array.contains(artifactsPref, 'agreement')) {
                this._onShowAgreementsClicked(null, true);
            }
        },

        _onShowAgreementsClicked: function(checkbox, checked) {
            Ext.each(this.cardboard.getColumns(), function(column) {
                column.togglePolicy(checked);
            });
        },

        _onBeforeCreate: function(addNew, record, params) {
            var type;
            Ext.apply(params, {
                rankTo: 'BOTTOM',
                rankScope: 'BACKLOG'
            });
            record.set(this.getSetting('groupByField'), this.cardboard.getColumns()[0].getValue());

            // BEGIN FOR SCOPING ADDITION
            if (this.timeboxScope) {
              type = this.timeboxScope.getRecord().get("_type");
              if (type.toLowerCase() === "release") {
                record.set("Release", this.timeboxScope.getRecord().get("_ref"));
              } else if (type.toLowerCase() === "iteration") {
                record.set("Iteration", this.timeboxScope.getRecord().get("_ref"));
              }
            }
            // END FOR SCOPING ADDITION
        },

        _onBeforeEditorShow: function(addNew, params) {
            var type;

            params.rankTo = 'BOTTOM';
            params.rankScope = 'BACKLOG';
            params.iteration = 'u';
            params.release = 'u';

            // BEGIN FOR SCOPING ADDITION
            if (this.timeboxScope) {
              type = this.timeboxScope.getRecord().get("_type");
              params[type] = Rally.util.Ref.getOidFromRef(this.timeboxScope.getRecord().get('_ref')) || 'u';
            }
            // END FOR SCOPING ADDITION

            var groupByFieldName = this.groupByField.name;
            if (!this.getContext().isFeatureEnabled('WSAPI_2_0_LIVE')) {
                groupByFieldName = 'c_' + groupByFieldName;
            }
            params[groupByFieldName] = this.cardboard.getColumns()[0].getValue();
        },

        _onCreate: function(addNew, record) {
            this._showCreationFlair(record);
        },

        _onCardCopied: function(card, record) {
            this._showCreationFlair(record);
        },

        _showCreationFlair: function(record) {
            Rally.ui.notify.Notifier.showCreate({
                artifact: record,
                rankScope: 'BACKLOG'
            });
        },

        _publishContentUpdated: function() {
            this.fireEvent('contentupdated');
            if (Rally.BrowserTest) {
                Rally.BrowserTest.publishComponentReady(this);
            }
        },

        _publishContentUpdatedNoDashboardLayout: function() {
            this.fireEvent('contentupdated', {dashboardLayout: false});
        },

        _onBeforeCardSaved: function(column, card, type) {
            var columnSetting = this._getColumnSetting();
            if (columnSetting) {
                var setting = columnSetting[column.getValue()];
                if (setting && setting.scheduleStateMapping) {
                    card.getRecord().set('ScheduleState', setting.scheduleStateMapping);
                }
            }
        },

        _getAgreementsTypeConfig: function() {
            return {
                xtype: 'checkboxfield',
                cls: 'type-checkbox agreements-checkbox',
                boxLabel: 'Agreements',
                itemId: 'showAgreements',
                inputValue: 'agreement',
                handler: this._onShowAgreementsClicked,
                scope: this
            };
        },

        /**
         * @private
         * Show a warning flair if the workspace is manually ranked
         */
        _showDnDRankWarning: function() {
            if (!this.getContext().getWorkspace().WorkspaceConfiguration.DragDropRankingEnabled) {

                var notification = Ext.create('Rally.ui.notify.Notification', {
                    message: "Drag and drop re-ranking is disabled for Manual Rank Workspaces.",
                    duration: 5000
                });

                this.down('.rallyleftright').add(notification);
            }

        }
    });
})();
