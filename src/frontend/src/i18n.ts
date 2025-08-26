import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    common: {
      appTitle: 'Vionix Consulting',
      nav: {
        accounts: 'Accounts',
        directors: 'Directors',
        agents: 'Agents',
        filters: 'Filters',
        prompts: 'Prompts',
        admin: 'Admin',
        memory: 'Memory',
        results: 'Results',
      },
      adminTabs: {
        diagnostics: 'Diagnostics',
        conversations: 'Conversations',
        settings: 'Settings',
        fetcher: 'Fetcher',
        accounts: 'Accounts',
        orchestrationDiagnostics: 'Orchestration',
        tracesDiagnostics: 'Traces'
      },
      theme: {
        light: 'Light',
        dark: 'Dark',
        system: 'System',
      },
      sidebar: {
        collapse: 'Collapse sidebar',
        expand: 'Expand sidebar',
      },
      lang: {
        en: 'English',
        th: 'ไทย',
      },
      tabs: {
        details: 'Details',
        tools: 'Tools',
        agents: 'Agents'
      },
      labels: {
        yes: 'Yes',
        no: 'No',
        none: 'None',
        more: 'more'
      },
      filters: {
        title: 'Filters',
        addTitle: 'Add Filter',
        editTitle: 'Edit Filter',
        fields: {
          from: 'From',
          to: 'To',
          cc: 'Cc',
          bcc: 'Bcc',
          subject: 'Subject',
          body: 'Body',
          date: 'Date'
        },
        table: {
          field: 'Field',
          regex: 'Regex',
          duplicate: 'Duplicate',
          director: 'Director',
          actions: 'Actions'
        },
        form: {
          field: 'Field',
          regex: 'Regex',
          duplicateLabel: 'Allow duplicates',
          director: 'Director'
        },
        tooltips: {
          moveUp: 'Move up',
          moveDown: 'Move down',
          edit: 'Edit',
          delete: 'Delete'
        },
        messages: {
          deleted: 'Deleted',
          orderUpdated: 'Order updated',
          added: 'Added',
          updated: 'Updated'
        },
        errors: {
          failedLoadFilters: 'Failed to load filters',
          failedLoadDirectors: 'Failed to load directors',
          failedOrder: 'Failed to persist order',
          failedDelete: 'Failed to delete filter',
          missingRegexDirector: 'Regex and Director are required',
          failedSave: 'Failed to save filter'
        }
      },
      traces: {
        title: 'Diagnostics — Traces',
        tooltips: {
          refresh: 'Refresh',
          deleteActive: 'Delete active',
          deleteAll: 'Delete all'
        },
        confirm: {
          deleteOne: 'Delete trace {{id}}?',
          deleteAll: 'Delete ALL {{count}} trace(s)?'
        },
        errors: {
          failedLoad: 'Failed to load traces',
          failedDelete: 'Failed to delete trace',
          failedBulkDelete: 'Failed to bulk delete traces'
        },
        filters: {
          emailId: 'Email ID',
          directorId: 'Director ID',
          agentId: 'Agent ID',
          status: 'Status',
          spanType: 'Span Type',
          since: 'Since',
          until: 'Until',
          apply: 'Apply',
          reset: 'Reset'
        },
        table: {
          time: 'Time',
          status: 'Status',
          spans: 'Spans',
          email: 'Email',
          director: 'Director',
          agent: 'Agent'
        },
        detail: {
          select: 'Select a trace to view details.',
          overview: 'Overview',
          spansJson: 'Spans (JSON)',
          spans: 'Spans',
          timelineCaption: 'Timeline spans are scaled relative to the earliest start. Colors by type; red indicates error.'
        }
      },
      directors: {
        title: 'Directors',
        addTitle: 'Add Director',
        editTitle: 'Edit Director',
        table: {
          name: 'Name',
          agents: 'Agents',
          actions: 'Actions'
        },
        form: {
          name: 'Name',
          prompt: 'Prompt',
          apiConfig: 'API Config',
          optionalTools: 'Optional Tools',
          assignedAgents: 'Assigned Agents (ordered):',
          addAgent: 'Add Agent:'
        },
        test: {
          title: 'Director OpenAI Test',
          testing: 'Testing...',
          succeeded: 'Test succeeded',
          failed: 'Test failed',
          cta: 'Test'
        },
        messages: {
          deleted: 'Director deleted',
          added: 'Director added',
          updated: 'Director updated'
        },
        manageAgentsTitle: 'Agents',
        manageAgentsHint: 'Manage agents on the Agents page; quick summary below.',
        errors: {
          failedLoadDirectors: 'Failed to load directors',
          failedLoadAgents: 'Failed to load agents',
          failedLoadPrompts: 'Failed to load prompts',
          failedDelete: 'Failed to delete director',
          nameRequired: 'Name is required',
          apiConfigRequired: 'API Config is required',
          failedSave: 'Failed to save director'
        }
      },
      agents: {
        title: 'Agents',
        addTitle: 'Add Agent',
        editTitle: 'Edit Agent',
        table: {
          name: 'Name',
          type: 'Type',
          prompt: 'Prompt',
          actions: 'Actions'
        },
        form: {
          name: 'Name',
          type: 'Type',
          prompt: 'Prompt',
          apiConfig: 'API Config',
          optionalTools: 'Optional Tools'
        },
        test: {
          title: 'Agent OpenAI Test',
          testing: 'Testing...',
          succeeded: 'Test succeeded',
          failed: 'Test failed',
          cta: 'Test'
        },
        messages: {
          deleted: 'Agent deleted',
          added: 'Agent added',
          updated: 'Agent updated'
        },
        errors: {
          failedLoadAgents: 'Failed to load agents',
          failedLoadPrompts: 'Failed to load prompts',
          failedDelete: 'Failed to delete agent',
          nameRequired: 'Name is required',
          apiConfigRequired: 'API Config is required',
          failedSave: 'Failed to save agent'
        }
      },
      prompts: {
        title: 'Prompts & Templates',
        tabs: {
          prompts: 'Prompts',
          templates: 'Templates'
        },
        buttons: {
          addPrompt: 'Add Prompt'
        },
        table: {
          name: 'Name',
          messages: 'Messages',
          actions: 'Actions'
        },
        dialog: {
          addTitle: 'Add Prompt',
          editTitle: 'Edit Prompt',
          tabs: {
            edit: 'Edit',
            generate: 'Generate'
          },
          form: {
            template: 'Template',
            name: 'Name',
            role: 'Role',
            content: 'Content'
          },
          sections: {
            promptMessages: 'Prompt Messages',
            preview: 'Preview',
            messagesRaw: 'Messages (raw)'
          },
          emptyNoMessages: 'No messages defined.',
          addMessage: 'Add Message',
          assistant: {
            tooltip: 'Prompt templates can use variables like {{email}}, {{sender}}, etc. These will be replaced at runtime.',
            errors: {
              requestFailed: 'Assistant request failed',
              noImprovements: 'Assistant returned no improvements'
            }
          },
          optimize: {
            info: 'Use the assistant to generate or improve messages. Select a target to avoid auto-detection. This does not modify saved prompts until you click Save.',
            target: {
              label: 'Target',
              placeholder: 'Select target…',
              director: 'Director',
              agent: 'Agent'
            },
            including: {
              label: 'Including',
              none: 'None',
              optional: 'Optional (examples, policies)',
              all: 'All packs'
            },
            optimizing: 'Optimizing…',
            cta: 'Optimize with Assistant',
            notesTitle: 'Assistant notes'
          }
        },
        variables: {
          tooltip: 'Insert template variable',
          ariaLabel: 'Insert variable',
          items: {
            email: { description: 'The full email content.' },
            sender: { description: 'The sender of the email.' },
            recipient: { description: 'The recipient of the email.' },
            subject: { description: 'The subject line.' }
          }
        },
        messages: {
          deleted: 'Prompt deleted',
          added: 'Prompt added',
          updated: 'Prompt updated'
        },
        errors: {
          failedLoadPrompts: 'Failed to load prompts',
          failedDelete: 'Failed to delete prompt',
          failedSave: 'Failed to save prompt',
          nameAndMessageRequired: 'Name and at least one non-empty message are required'
        }
      },
      templates: {
        buttons: {
          addTemplate: 'Add Template'
        },
        table: {
          id: 'ID',
          name: 'Name',
          messages: 'Messages',
          actions: 'Actions'
        },
        dialog: {
          addTitle: 'Add Template',
          editTitle: 'Edit Template',
          form: {
            name: 'Name',
            description: 'Description',
            role: 'Role',
            content: 'Content'
          },
          sections: {
            templateMessages: 'Template Messages',
            preview: 'Preview',
            messagesRaw: 'Messages (raw)'
          },
          emptyNoMessages: 'No messages defined.',
          addMessage: 'Add Message'
        },
        tooltips: {
          edit: 'Edit template',
          delete: 'Delete template',
          cannotDeleteSystem: 'This system template cannot be deleted'
        },
        messages: {
          deleted: 'Template deleted',
          added: 'Template added',
          updated: 'Template updated'
        },
        errors: {
          failedLoadTemplates: 'Failed to load templates',
          failedDelete: 'Failed to delete template',
          failedSave: 'Failed to save template',
          idNameMessageRequired: 'Template id, name and at least one non-empty message are required'
        }
      },
      settings: {
        title: 'Application Settings',
        form: {
          virtualRoot: 'Virtual Root',
          sessionTimeout: 'Session Timeout (minutes)',
          sessionTimeoutHelper: 'Agent sessions expire after this period of inactivity'
        },
        apiConfigs: {
          title: 'API Keys & Models',
          empty: 'No API configs defined.',
          add: 'Add API Config',
          labels: {
            model: 'Model',
            maxTokens: 'Max tokens',
            key: 'Key',
            notSet: 'Not set'
          },
          test: {
            cta: 'Test',
            title: 'API Config OpenAI Test',
            testing: 'Testing...',
            succeeded: 'Test succeeded'
          },
          editTitle: 'Edit API Config',
          addTitle: 'Add API Config',
          fields: {
            name: 'Name',
            model: 'Model',
            apiKey: 'API Key',
            maxOutputTokens: 'Max Output Tokens',
            maxOutputTokensHelper: 'Optional cap for assistant output tokens (OpenAI max_completion_tokens)'
          },
          messages: {
            deletedSaved: 'API config deleted and settings saved',
            savedUpdated: 'API config saved and settings updated'
          }
        },
        maintenance: {
          title: 'Maintenance',
          deleteFetcherLogs: 'Delete All Fetcher Logs',
          deleteOrchestrationLogs: 'Delete All Orchestration Logs',
          deleteConversations: 'Delete All Conversations',
          confirm: {
            logs: {
              title: 'Delete all fetcher logs?',
              body: 'This will permanently delete all fetcher log entries. This action cannot be undone.'
            },
            orch: {
              title: 'Delete all orchestration logs?',
              body: 'This will permanently delete all orchestration diagnostics entries. This action cannot be undone.'
            },
            convs: {
              title: 'Delete all conversations?',
              body: 'This will permanently delete all conversations, including agent threads. This action cannot be undone.'
            }
          }
        },
        saveCta: 'Save Settings',
        messages: {
          saved: 'Settings saved successfully',
          noFetcherLogs: 'No fetcher logs to delete',
          deletedFetcherLogs: 'Deleted {{count}} fetcher log(s)',
          noOrchestrationLogs: 'No orchestration logs to delete',
          deletedOrchestrationLogs: 'Deleted {{count}} orchestration log(s)',
          noConversations: 'No conversations to delete',
          deletedConversations: 'Deleted {{count}} conversation(s)'
        },
        errors: {
          failedLoad: 'Failed to load settings',
          failedSave: 'Failed to save settings',
          failedDeleteFetcherLogs: 'Failed to delete fetcher logs',
          failedDeleteOrchestrationLogs: 'Failed to delete orchestration logs',
          failedLoadConversations: 'Failed to load conversations',
          failedDeleteConversations: 'Failed to delete conversations'
        }
      },
      
      results: {
        title: 'Results',
        refresh: 'Refresh',
        emails: 'Emails',
        filterPlaceholder: 'Filter subject/from',
        noResults: 'No results yet. Start processing in Fetcher Control.',
        noMatches: 'No matches',
        noItems: 'No items',
        selectItem: 'Select an item to preview.',
        backToDirector: 'Back to Director',
        open: 'open',
        image: 'Image',
        attachment: 'Attachment',
        collapse: 'collapse',
        expand: 'expand',
        processing: 'Processing...',
        noSubject: '(no subject)',
        failedLoad: 'Failed to load conversations',
        preview: 'Preview',
        imageAlt: 'image'
      },
      actions: {
        cancel: 'Cancel',
        save: 'Save',
        add: 'Add',
        edit: 'Edit',
        delete: 'Delete',
        refresh: 'Refresh',
        retry: 'Retry',
        close: 'Close',
        start: 'Start',
        stop: 'Stop',
        triggerNow: 'Trigger Now',
        search: 'Search',
        viewTrace: 'View Trace',
        logout: 'Logout'
      },
      accounts: {
        add: 'Add Account',
        empty: 'No accounts yet.',
        provider: 'Provider',
        gmail: 'Gmail',
        outlook: 'Outlook',
        continueWith: 'Continue with {{provider}}',
        editAccount: 'Edit Account',
        email: 'Email',
        id: 'ID',
        signature: 'Signature',
        refreshToken: 'Refresh Token',
        testGmail: 'Test Gmail',
        testOutlook: 'Test Outlook',
        none: '[none]',
        chips: {
          provider: 'Provider: {{provider}}'
        },
        access: {
          set: 'Access: set',
          missing: 'Access: missing'
        },
        refresh: {
          set: 'Refresh: set',
          missing: 'Refresh: missing'
        },
        expiry: 'Expiry: {{label}}',
        test: {
          title: 'Gmail Account Test',
          titleOutlook: 'Outlook Account Test',
          testing: 'Testing...',
          succeeded: 'Test succeeded'
        },
        errors: {
          failedUpdate: 'Failed to update account',
          testFailed: 'Test failed',
          failedDelete: 'Failed to delete account',
          apiError: 'API error',
          failedLoad: 'Failed to load accounts',
          refreshFailed: 'Refresh failed',
          failedRefreshToken: 'Failed to refresh token'
        }
      },
      oauth: {
        completing: 'Completing authentication...',
        errorTitle: 'OAuth Error',
        redirecting: 'Authentication complete. Redirecting...',
        missingProviderOrCode: 'Missing provider or code in OAuth callback.',
        failed: 'OAuth callback failed',
        failedPersist: 'Failed to persist account.',
        noAccount: 'No valid account returned from backend.',
        initiateFailed: 'Failed to initiate new OAuth2 flow',
        abort: 'Abort',
        retry: 'Retry',
        labels: {
          message: 'Message:',
          error: 'Error:',
          description: 'Description:',
          moreInfo: 'More Info:',
          stack: 'Stack Trace'
        }
      },
      memory: {
        title: 'Memory',
        scopeLabel: 'Scope',
        scope: {
          global: 'Global',
          shared: 'Shared',
          local: 'Local'
        },
        ownerTypeLabel: 'Owner Type',
        ownerLabel: 'Owner',
        ownerTypes: {
          all: 'All',
          agent: 'Agent',
          director: 'Director',
          user: 'User'
        },
        owner: {
          none: 'None',
          agent: 'Agent: {{name}}',
          director: 'Director: {{name}}',
          user: 'User: {{email}}'
        },
        search: 'Search',
        add: 'Add',
        table: {
          scope: 'Scope',
          content: 'Content',
          tags: 'Tags',
          owner: 'Owner',
          provenance: 'Provenance',
          created: 'Created',
          updated: 'Updated',
          actions: 'Actions',
          unknown: 'Unknown'
        },
        tooltips: {
          refresh: 'Refresh',
          deleteSelected: 'Delete selected',
          deleteAll: 'Delete all',
          edit: 'Edit',
          delete: 'Delete'
        },
        dialog: {
          addTitle: 'Add Memory',
          editTitle: 'Edit Memory',
          contentLabel: 'Content',
          tagsCommaLabel: 'Tags (comma-separated)',
          relatedEmailId: 'Related Email Id',
          metadataJson: 'Metadata (JSON)'
        },
        messages: {
          saved: 'Saved',
          deleted: 'Deleted',
          deletedAll: 'Deleted all'
        },
        errors: {
          failedLoad: 'Failed to load memory',
          searchFailed: 'Search failed',
          deleteFailed: 'Delete failed',
          batchDeleteFailed: 'Batch delete failed',
          deleteAllFailed: 'Delete all failed',
          saveFailed: 'Save failed'
        },
        confirm: {
          deleteOne: 'Delete memory entry {{id}}?',
          deleteSelected: 'Delete {{count}} selected entries?',
          deleteAll: 'Delete ALL {{count}} entries?'
        },
        provenanceFormat: '{{scope}} / {{owner}}'
      },
      fetcher: {
        title: 'Fetcher Control',
        subtitle: 'Persistent, parallel, on-demand fetcher control and diagnostics.',
        loading: 'Loading fetcher status...',
        status: 'Status:',
        active: 'Active',
        running: 'Running…',
        stopped: 'Stopped',
        lastRun: 'Last run:',
        nextRun: 'Next run:',
        never: 'Never',
        na: 'N/A',
        perAccount: 'Per-Account Status:',
        table: {
          accountId: 'Account ID',
          lastRun: 'Last Run',
          lastError: 'Last Error'
        },
        tooltips: {
          refresh: 'Refresh',
          deleteActive: 'Delete active',
          deleteSelected: 'Delete selected',
          deleteAll: 'Delete all'
        },
        autoRefreshOn: 'Auto-refresh: On',
        autoRefreshOff: 'Auto-refresh: Off',
        logs: {
          title: 'Fetcher Logs',
          filters: {
            level: 'Level',
            provider: 'Provider',
            account: 'Account',
            event: 'Event',
            search: 'Search',
            all: 'All'
          },
          headers: {
            timestamp: 'Timestamp',
            level: 'Level',
            provider: 'Provider',
            account: 'Account',
            event: 'Event',
            message: 'Message',
            email: 'Email',
            count: 'Count',
            actions: 'Actions'
          },
          copyRow: 'Copy row',
          activeDetail: 'Active Log Detail',
          labels: {
            timestamp: 'Timestamp:',
            level: 'Level:',
            event: 'Event:',
            message: 'Message:',
            provider: 'Provider:',
            account: 'Account:',
            email: 'Email:',
            count: 'Count:'
          },
          detail: 'Detail'
        },
        copied: 'Copied to clipboard',
        errors: {
          copyFailed: 'Copy failed',
          deleteFailed: 'Failed to delete log',
          bulkDeleteFailed: 'Failed to bulk delete logs'
        },
        confirm: {
          deleteOne: 'Delete log {{timestamp}}?',
          deleteSelected: 'Delete {{count}} selected log(s)?',
          deleteAll: 'Delete ALL {{count}} log(s)?'
        }
      },
      orchestration: {
        title: 'Orchestration Diagnostics',
        view: {
          grouped: 'Grouped',
          flat: 'Flat'
        },
        tooltips: {
          refresh: 'Refresh',
          deleteActive: 'Delete active',
          deleteAll: 'Delete all'
        },
        confirm: {
          deleteOne: 'Delete entry {{timestamp}}?',
          deleteAll: 'Delete ALL {{count}} entries?'
        },
        errors: {
          failedLoad: 'Failed to load orchestration diagnostics'
        },
        runtime: {
          title: 'Runtime',
          encryption: 'Encryption',
          disabled: 'disabled',
          orchestrationLogEntries: 'Orchestration log entries',
          conversations: 'Conversations',
          dataDir: 'Data directory'
        },
        grouped: {
          cyclePrefix: 'Cycle',
          unknown: 'unknown',
          directorsCount: '{{count}} director(s)',
          eventsCount: '{{count}} event(s)',
          agentsCount: '{{count}} agent(s)',
          agentPrefix: 'Agent'
        },
        labels: {
          error: 'Error',
          errors: 'Errors'
        },
        table: {
          timestamp: 'Timestamp',
          director: 'Director',
          agent: 'Agent',
          email: 'Email',
          hasResult: 'Has Result',
          error: 'Error',
          actions: 'Actions'
        },
        tabs: {
          result: 'Result',
          email: 'Email'
        },
        detail: {
          selectEvent: 'Select an event',
          resultPayloadDebug: 'Result payload (debug)',
          hideJson: 'Hide JSON',
          showJson: 'Show JSON',
          noResult: 'No result',
          diagnosticDetail: 'Diagnostic detail',
          errorTitle: 'Error',
          originalEmail: 'Original email',
          from: 'From:',
          date: 'Date:',
          hideRawEmail: 'Hide raw email',
          showRawEmail: 'Show raw email',
          attachments: 'Attachments'
        }
      },
      conversations: {
        title: 'Conversations',
        tooltips: {
          deleteActive: 'Delete active',
          deleteAll: 'Delete all',
          refresh: 'Refresh'
        },
        filters: {
          status: 'Status',
          director: 'Director',
          agent: 'Agent',
          kind: 'Kind',
          all: 'All',
          statusOptions: {
            ongoing: 'ongoing',
            completed: 'completed',
            failed: 'failed',
            finalized: 'finalized'
          },
          kindOptions: {
            director: 'director',
            agent: 'agent'
          }
        },
        table: {
          started: 'Started',
          status: 'Status',
          kind: 'Kind',
          director: 'Director',
          agent: 'Agent',
          subject: 'Subject',
          actions: 'Actions'
        },
        empty: 'No conversations',
        detail: {
          title: 'Conversation: {{id}}',
          finalize: 'Finalize Workspace',
          finalizing: 'Finalizing…',
          transcript: 'Transcript',
          noMessages: 'No messages',
          labels: {
            lastActive: 'Last Active',
            endedAt: 'Ended At'
          }
        },
        workspace: {
          title: 'Workspace Items',
          add: {
            type: 'Type',
            label: 'Label',
            description: 'Description',
            tags: 'Tags (comma)',
            data: 'Data',
            mimeType: 'Mime Type',
            encoding: 'Encoding',
            encodingNone: '(none)',
            refresh: 'Refresh Items',
            add: 'Add'
          },
          table: {
            type: 'Type',
            provenance: 'Provenance',
            tags: 'Tags',
            preview: 'Preview',
            mime: 'Mime',
            revision: 'Revision',
            created: 'Created',
            updated: 'Updated',
            actions: 'Actions'
          },
          empty: 'No workspace items',
          editTitle: 'Edit Workspace Item'
        },
        confirm: {
          deleteOne: 'Delete conversation {{id}} (including children)?',
          deleteAll: 'Delete ALL {{count}} visible conversation(s)?'
        }
      }
    }
  },
  th: {
    common: {
      appTitle: 'Vionix Consulting',
      nav: {
        accounts: 'บัญชี',
        directors: 'ไดเร็กเตอร์',
        agents: 'เอเจนต์',
        filters: 'ฟิลเตอร์',
        prompts: 'พรอมพ์',
        admin: 'แอดมิน',
        memory: 'เมมโมรี่',
        results: 'ผลลัพธ์',
      },
      adminTabs: {
        diagnostics: 'การวินิจฉัย',
        conversations: 'การสนทนา',
        settings: 'การตั้งค่า',
        fetcher: 'ตัวดึงข้อมูล',
        accounts: 'บัญชี',
        orchestrationDiagnostics: 'ออร์เคสเตรชัน',
        tracesDiagnostics: 'เทรซ'
      },
      theme: {
        light: 'สว่าง',
        dark: 'มืด',
        system: 'ตามระบบ',
      },
      sidebar: {
        collapse: 'ยุบแถบด้านข้าง',
        expand: 'ขยายแถบด้านข้าง',
      },
      lang: {
        en: 'English',
        th: 'ไทย',
      },
      tabs: {
        details: 'รายละเอียด',
        tools: 'เครื่องมือ',
        agents: 'เอเจนต์'
      },
      labels: {
        yes: 'ใช่',
        no: 'ไม่',
        none: 'ไม่มี',
        more: 'เพิ่มเติม'
      },
      filters: {
        title: 'ฟิลเตอร์',
        addTitle: 'เพิ่มฟิลเตอร์',
        editTitle: 'แก้ไขฟิลเตอร์',
        fields: {
          from: 'จาก',
          to: 'ถึง',
          cc: 'Cc',
          bcc: 'Bcc',
          subject: 'หัวเรื่อง',
          body: 'เนื้อความ',
          date: 'วันที่'
        },
        table: {
          field: 'ฟิลด์',
          regex: 'Regex',
          duplicate: 'อนุญาตซ้ำ',
          director: 'ไดเร็กเตอร์',
          actions: 'การทำงาน'
        },
        form: {
          field: 'ฟิลด์',
          regex: 'Regex',
          duplicateLabel: 'อนุญาตให้ซ้ำ',
          director: 'ไดเร็กเตอร์'
        },
        tooltips: {
          moveUp: 'ย้ายขึ้น',
          moveDown: 'ย้ายลง',
          edit: 'แก้ไข',
          delete: 'ลบ'
        },
        messages: {
          deleted: 'ลบแล้ว',
          orderUpdated: 'อัปเดตลำดับแล้ว',
          added: 'เพิ่มแล้ว',
          updated: 'อัปเดตแล้ว'
        },
        errors: {
          failedLoadFilters: 'โหลดฟิลเตอร์ไม่สำเร็จ',
          failedLoadDirectors: 'โหลดไดเร็กเตอร์ไม่สำเร็จ',
          failedOrder: 'บันทึกลำดับไม่สำเร็จ',
          failedDelete: 'ลบฟิลเตอร์ไม่สำเร็จ',
          missingRegexDirector: 'ต้องกรอก Regex และไดเร็กเตอร์',
          failedSave: 'บันทึกฟิลเตอร์ไม่สำเร็จ'
        }
      },
      directors: {
        title: 'ไดเร็กเตอร์',
        addTitle: 'เพิ่มไดเร็กเตอร์',
        editTitle: 'แก้ไขไดเร็กเตอร์',
        table: {
          name: 'ชื่อ',
          agents: 'เอเจนต์',
          actions: 'การทำงาน'
        },
        form: {
          name: 'ชื่อ',
          prompt: 'พรอมพ์',
          apiConfig: 'การตั้งค่า API',
          optionalTools: 'เครื่องมือเสริม',
          assignedAgents: 'เอเจนต์ที่กำหนด (เรียงลำดับ):',
          addAgent: 'เพิ่มเอเจนต์:'
        },
        test: {
          title: 'ทดสอบไดเร็กเตอร์ OpenAI',
          testing: 'กำลังทดสอบ...',
          succeeded: 'ทดสอบสำเร็จ',
          failed: 'ทดสอบล้มเหลว',
          cta: 'ทดสอบ'
        },
        messages: {
          deleted: 'ลบไดเร็กเตอร์แล้ว',
          added: 'เพิ่มไดเร็กเตอร์แล้ว',
          updated: 'อัปเดตไดเร็กเตอร์แล้ว'
        },
        manageAgentsTitle: 'เอเจนต์',
        manageAgentsHint: 'จัดการเอเจนต์ในหน้าเอเจนต์ ส่วนนี้เป็นสรุปย่อ',
        errors: {
          failedLoadDirectors: 'โหลดไดเร็กเตอร์ไม่สำเร็จ',
          failedLoadAgents: 'โหลดเอเจนต์ไม่สำเร็จ',
          failedLoadPrompts: 'โหลดพรอมพ์ไม่สำเร็จ',
          failedDelete: 'ลบไดเร็กเตอร์ไม่สำเร็จ',
          nameRequired: 'ต้องระบุชื่อ',
          apiConfigRequired: 'ต้องระบุการตั้งค่า API',
          failedSave: 'บันทึกไดเร็กเตอร์ไม่สำเร็จ'
        }
      },
      agents: {
        title: 'เอเจนต์',
        addTitle: 'เพิ่มเอเจนต์',
        editTitle: 'แก้ไขเอเจนต์',
        table: {
          name: 'ชื่อ',
          type: 'ชนิด',
          prompt: 'พรอมพ์',
          actions: 'การทำงาน'
        },
        form: {
          name: 'ชื่อ',
          type: 'ชนิด',
          prompt: 'พรอมพ์',
          apiConfig: 'การตั้งค่า API',
          optionalTools: 'เครื่องมือเสริม'
        },
        test: {
          title: 'ทดสอบเอเจนต์ OpenAI',
          testing: 'กำลังทดสอบ...',
          succeeded: 'ทดสอบสำเร็จ',
          failed: 'ทดสอบล้มเหลว',
          cta: 'ทดสอบ'
        },
        messages: {
          deleted: 'ลบเอเจนต์แล้ว',
          added: 'เพิ่มเอเจนต์แล้ว',
          updated: 'อัปเดตเอเจนต์แล้ว'
        },
        errors: {
          failedLoadAgents: 'โหลดเอเจนต์ไม่สำเร็จ',
          failedLoadPrompts: 'โหลดพรอมพ์ไม่สำเร็จ',
          failedDelete: 'ลบเอเจนต์ไม่สำเร็จ',
          nameRequired: 'ต้องระบุชื่อ',
          apiConfigRequired: 'ต้องระบุการตั้งค่า API',
          failedSave: 'บันทึกเอเจนต์ไม่สำเร็จ'
        }
      },
      prompts: {
        title: 'พรอมพ์ & เทมเพลต',
        tabs: {
          prompts: 'พรอมพ์',
          templates: 'เทมเพลต'
        },
        buttons: {
          addPrompt: 'เพิ่มพรอมพ์'
        },
        table: {
          name: 'ชื่อ',
          messages: 'ข้อความ',
          actions: 'การทำงาน'
        },
        dialog: {
          addTitle: 'เพิ่มพรอมพ์',
          editTitle: 'แก้ไขพรอมพ์',
          tabs: {
            edit: 'แก้ไข',
            generate: 'สร้าง'
          },
          form: {
            template: 'เทมเพลต',
            name: 'ชื่อ',
            role: 'บทบาท',
            content: 'เนื้อหา'
          },
          sections: {
            promptMessages: 'ข้อความของพรอมพ์',
            preview: 'ตัวอย่าง',
            messagesRaw: 'ข้อความ (ดิบ)'
          },
          emptyNoMessages: 'ยังไม่มีข้อความ',
          addMessage: 'เพิ่มข้อความ',
          assistant: {
            tooltip: 'เทมเพลตของพรอมพ์สามารถใช้ตัวแปรอย่าง {{email}}, {{sender}} เป็นต้น และจะถูกแทนที่ตอนรันไทม์',
            errors: {
              requestFailed: 'คำขอผู้ช่วยล้มเหลว',
              noImprovements: 'ผู้ช่วยไม่พบการปรับปรุง'
            }
          },
          optimize: {
            info: 'ใช้ผู้ช่วยเพื่อสร้างหรือปรับปรุงข้อความ เลือกเป้าหมายเพื่อหลีกเลี่ยงการตรวจจับอัตโนมัติ สิ่งนี้จะไม่แก้ไขพรอมพ์ที่บันทึกจนกว่าจะกดบันทึก',
            target: {
              label: 'เป้าหมาย',
              placeholder: 'เลือกเป้าหมาย…',
              director: 'ไดเร็กเตอร์',
              agent: 'เอเจนต์'
            },
            including: {
              label: 'รวม',
              none: 'ไม่มี',
              optional: 'ตัวเลือก (ตัวอย่าง นโยบาย)',
              all: 'ทุกแพ็ก'
            },
            optimizing: 'กำลังปรับให้เหมาะสม…',
            cta: 'ปรับด้วยผู้ช่วย',
            notesTitle: 'บันทึกของผู้ช่วย'
          }
        },
        variables: {
          tooltip: 'แทรกตัวแปรเทมเพลต',
          ariaLabel: 'แทรกตัวแปร',
          items: {
            email: { description: 'เนื้อหาอีเมลทั้งหมด' },
            sender: { description: 'ผู้ส่งอีเมล' },
            recipient: { description: 'ผู้รับอีเมล' },
            subject: { description: 'หัวเรื่องอีเมล' }
          }
        },
        messages: {
          deleted: 'ลบพรอมพ์แล้ว',
          added: 'เพิ่มพรอมพ์แล้ว',
          updated: 'อัปเดตพรอมพ์แล้ว'
        },
        errors: {
          failedLoadPrompts: 'โหลดพรอมพ์ไม่สำเร็จ',
          failedDelete: 'ลบพรอมพ์ไม่สำเร็จ',
          failedSave: 'บันทึกพรอมพ์ไม่สำเร็จ',
          nameAndMessageRequired: 'ต้องมีชื่อและอย่างน้อยหนึ่งข้อความที่ไม่ว่าง'
        }
      },
      templates: {
        buttons: {
          addTemplate: 'เพิ่มเทมเพลต'
        },
        table: {
          id: 'ไอดี',
          name: 'ชื่อ',
          messages: 'ข้อความ',
          actions: 'การทำงาน'
        },
        dialog: {
          addTitle: 'เพิ่มเทมเพลต',
          editTitle: 'แก้ไขเทมเพลต',
          form: {
            name: 'ชื่อ',
            description: 'คำอธิบาย',
            role: 'บทบาท',
            content: 'เนื้อหา'
          },
          sections: {
            templateMessages: 'ข้อความของเทมเพลต',
            preview: 'ตัวอย่าง',
            messagesRaw: 'ข้อความ (ดิบ)'
          },
          emptyNoMessages: 'ยังไม่มีข้อความ',
          addMessage: 'เพิ่มข้อความ'
        },
        tooltips: {
          edit: 'แก้ไขเทมเพลต',
          delete: 'ลบเทมเพลต',
          cannotDeleteSystem: 'ไม่สามารถลบเทมเพลตระบบนี้ได้'
        },
        messages: {
          deleted: 'ลบเทมเพลตแล้ว',
          added: 'เพิ่มเทมเพลตแล้ว',
          updated: 'อัปเดตเทมเพลตแล้ว'
        },
        errors: {
          failedLoadTemplates: 'โหลดเทมเพลตไม่สำเร็จ',
          failedDelete: 'ลบเทมเพลตไม่สำเร็จ',
          failedSave: 'บันทึกเทมเพลตไม่สำเร็จ',
          idNameMessageRequired: 'ต้องมีไอดี ชื่อ และอย่างน้อยหนึ่งข้อความที่ไม่ว่าง'
        }
      },
      settings: {
        title: 'การตั้งค่าแอปพลิเคชัน',
        form: {
          virtualRoot: 'รูทเสมือน',
          sessionTimeout: 'ระยะหมดเวลาของเซสชัน (นาที)',
          sessionTimeoutHelper: 'เซสชันของเอเจนต์จะหมดอายุหลังจากไม่มีการใช้งานตามช่วงเวลานี้'
        },
        apiConfigs: {
          title: 'คีย์ API และโมเดล',
          empty: 'ยังไม่มีการตั้งค่า API',
          add: 'เพิ่มการตั้งค่า API',
          labels: {
            model: 'โมเดล',
            maxTokens: 'โทเค็นสูงสุด',
            key: 'คีย์',
            notSet: 'ยังไม่ตั้งค่า'
          },
          test: {
            cta: 'ทดสอบ',
            title: 'ทดสอบการตั้งค่า API OpenAI',
            testing: 'กำลังทดสอบ...',
            succeeded: 'ทดสอบสำเร็จ'
          },
          editTitle: 'แก้ไขการตั้งค่า API',
          addTitle: 'เพิ่มการตั้งค่า API',
          fields: {
            name: 'ชื่อ',
            model: 'โมเดล',
            apiKey: 'คีย์ API',
            maxOutputTokens: 'จำนวนโทเค็นผลลัพธ์สูงสุด',
            maxOutputTokensHelper: 'เพดานโทเค็นผลลัพธ์ของผู้ช่วย (OpenAI max_completion_tokens) แบบไม่บังคับ'
          },
          messages: {
            deletedSaved: 'ลบการตั้งค่า API และบันทึกการตั้งค่าแล้ว',
            savedUpdated: 'บันทึกการตั้งค่า API และอัปเดตการตั้งค่าแล้ว'
          }
        },
        maintenance: {
          title: 'การบำรุงรักษา',
          deleteFetcherLogs: 'ลบล็อกของตัวดึงข้อมูลทั้งหมด',
          deleteOrchestrationLogs: 'ลบล็อกของออร์เคสเตรชันทั้งหมด',
          deleteConversations: 'ลบการสนทนาทั้งหมด',
          confirm: {
            logs: {
              title: 'ลบล็อกของตัวดึงข้อมูลทั้งหมด?',
              body: 'การทำงานนี้จะลบล็อกของตัวดึงข้อมูลทั้งหมดอย่างถาวร ไม่สามารถย้อนกลับได้'
            },
            orch: {
              title: 'ลบล็อกของออร์เคสเตรชันทั้งหมด?',
              body: 'การทำงานนี้จะลบข้อมูลการวินิจฉัยของออร์เคสเตรชันทั้งหมดอย่างถาวร ไม่สามารถย้อนกลับได้'
            },
            convs: {
              title: 'ลบการสนทนาทั้งหมด?',
              body: 'การทำงานนี้จะลบการสนทนาทั้งหมด รวมถึงเธรดของเอเจนต์ และไม่สามารถย้อนกลับได้'
            }
          }
        },
        saveCta: 'บันทึกการตั้งค่า',
        messages: {
          saved: 'บันทึกการตั้งค่าสำเร็จ',
          noFetcherLogs: 'ไม่มีล็อกของตัวดึงข้อมูลให้ลบ',
          deletedFetcherLogs: 'ลบล็อกของตัวดึงข้อมูล {{count}} รายการแล้ว',
          noOrchestrationLogs: 'ไม่มีล็อกของออร์เคสเตรชันให้ลบ',
          deletedOrchestrationLogs: 'ลบล็อกของออร์เคสเตรชัน {{count}} รายการแล้ว',
          noConversations: 'ไม่มีการสนทนาให้ลบ',
          deletedConversations: 'ลบการสนทนา {{count}} รายการแล้ว'
        },
        errors: {
          failedLoad: 'โหลดการตั้งค่าไม่สำเร็จ',
          failedSave: 'บันทึกการตั้งค่าไม่สำเร็จ',
          failedDeleteFetcherLogs: 'ลบล็อกของตัวดึงข้อมูลไม่สำเร็จ',
          failedDeleteOrchestrationLogs: 'ลบล็อกของออร์เคสเตรชันไม่สำเร็จ',
          failedLoadConversations: 'โหลดการสนทนาไม่สำเร็จ',
          failedDeleteConversations: 'ลบการสนทนาไม่สำเร็จ'
        }
      },
      results: {
        title: 'ผลลัพธ์',
        refresh: 'รีเฟรช',
        emails: 'อีเมล',
        filterPlaceholder: 'กรองหัวเรื่อง/จาก',
        noResults: 'ยังไม่มีผลลัพธ์ เริ่มประมวลผลที่การควบคุมตัวดึงข้อมูล',
        noMatches: 'ไม่พบรายการที่ตรงกัน',
        noItems: 'ไม่มีรายการ',
        selectItem: 'เลือกไอเท็มเพื่อดูตัวอย่าง',
        backToDirector: 'กลับไปที่ Director',
        open: 'เปิด',
        image: 'รูปภาพ',
        attachment: 'ไฟล์แนบ',
        collapse: 'ยุบ',
        expand: 'ขยาย',
        processing: 'กำลังประมวลผล...',
        noSubject: '(ไม่มีหัวเรื่อง)',
        failedLoad: 'ไม่สามารถโหลดการสนทนา',
        preview: 'ตัวอย่าง',
        imageAlt: 'รูปภาพ'
      },
      actions: {
        cancel: 'ยกเลิก',
        save: 'บันทึก',
        add: 'เพิ่ม',
        edit: 'แก้ไข',
        delete: 'ลบ',
        refresh: 'รีเฟรช',
        retry: 'ลองใหม่',
        close: 'ปิด',
        start: 'เริ่ม',
        stop: 'หยุด',
        triggerNow: 'เรียกตอนนี้',
        search: 'ค้นหา',
        viewTrace: 'ดู Trace',
        logout: 'ออกจากระบบ'
      },
      orchestration: {
        title: 'การวินิจฉัย Orchestration',
        view: {
          grouped: 'แบบกลุ่ม',
          flat: 'แบบรายการ'
        },
        tooltips: {
          refresh: 'รีเฟรช',
          deleteActive: 'ลบที่แอคทีฟ',
          deleteAll: 'ลบทั้งหมด'
        },
        confirm: {
          deleteOne: 'ลบรายการ {{timestamp}}?',
          deleteAll: 'ลบทั้งหมด {{count}} รายการ?'
        },
        errors: {
          failedLoad: 'โหลดการวินิจฉัยออร์เคสเตรชันไม่สำเร็จ'
        },
        runtime: {
          title: 'รันไทม์',
          encryption: 'การเข้ารหัส',
          disabled: 'ปิด',
          orchestrationLogEntries: 'จำนวนล็อกออร์เคสเตรชัน',
          conversations: 'การสนทนา',
          dataDir: 'ไดเรกทอรีข้อมูล'
        },
        grouped: {
          cyclePrefix: 'รอบ',
          unknown: 'ไม่ทราบ',
          directorsCount: '{{count}} ไดเร็กเตอร์',
          eventsCount: '{{count}} อีเวนต์',
          agentsCount: '{{count}} เอเจนต์',
          agentPrefix: 'เอเจนต์'
        },
        labels: {
          error: 'ข้อผิดพลาด',
          errors: 'ข้อผิดพลาด'
        },
        table: {
          timestamp: 'เวลา',
          director: 'ไดเร็กเตอร์',
          agent: 'เอเจนต์',
          email: 'อีเมล',
          hasResult: 'มีผลลัพธ์',
          error: 'ข้อผิดพลาด',
          actions: 'การทำงาน'
        },
        tabs: {
          result: 'ผลลัพธ์',
          email: 'อีเมล'
        },
        detail: {
          selectEvent: 'เลือกเหตุการณ์',
          resultPayloadDebug: 'ผลลัพธ์ (ดีบัก)',
          hideJson: 'ซ่อน JSON',
          showJson: 'แสดง JSON',
          noResult: 'ไม่มีผลลัพธ์',
          diagnosticDetail: 'รายละเอียดการวินิจฉัย',
          errorTitle: 'ข้อผิดพลาด',
          originalEmail: 'อีเมลต้นฉบับ',
          from: 'จาก:',
          date: 'วันที่:',
          hideRawEmail: 'ซ่อนอีเมลดิบ',
          showRawEmail: 'แสดงอีเมลดิบ',
          attachments: 'ไฟล์แนบ'
        }
      },
      traces: {
        title: 'การวินิจฉัย — Traces',
        tooltips: {
          refresh: 'รีเฟรช',
          deleteActive: 'ลบรายการที่เลือก',
          deleteAll: 'ลบทั้งหมด'
        },
        confirm: {
          deleteOne: 'ลบ trace {{id}}?',
          deleteAll: 'ลบ trace ทั้งหมด {{count}} รายการ?'
        },
        errors: {
          failedLoad: 'โหลด traces ไม่สำเร็จ',
          failedDelete: 'ลบ trace ไม่สำเร็จ',
          failedBulkDelete: 'ลบหลาย trace ไม่สำเร็จ'
        },
        filters: {
          emailId: 'อีเมล ID',
          directorId: 'ไดเร็กเตอร์ ID',
          agentId: 'เอเจนต์ ID',
          status: 'สถานะ',
          spanType: 'ชนิด Span',
          since: 'ตั้งแต่',
          until: 'จนถึง',
          apply: 'ใช้ฟิลเตอร์',
          reset: 'รีเซ็ต'
        },
        table: {
          time: 'เวลา',
          status: 'สถานะ',
          spans: 'Spans',
          email: 'อีเมล',
          director: 'ไดเร็กเตอร์',
          agent: 'เอเจนต์'
        },
        detail: {
          select: 'เลือก trace เพื่อดูรายละเอียด',
          overview: 'ภาพรวม',
          spansJson: 'Spans (JSON)',
          spans: 'Spans',
          timelineCaption: 'สเกลตามเวลาเริ่มต้นแรก สีตามชนิด; สีแดงหมายถึงข้อผิดพลาด'
        }
      },
      conversations: {
        title: 'การสนทนา',
        tooltips: {
          deleteActive: 'ลบที่เลือก',
          deleteAll: 'ลบทั้งหมด',
          refresh: 'รีเฟรช'
        },
        filters: {
          status: 'สถานะ',
          director: 'ไดเร็กเตอร์',
          agent: 'เอเจนต์',
          kind: 'ชนิด',
          all: 'ทั้งหมด',
          statusOptions: {
            ongoing: 'กำลังดำเนินการ',
            completed: 'เสร็จสิ้น',
            failed: 'ล้มเหลว',
            finalized: 'ปิดงาน'
          },
          kindOptions: {
            director: 'ไดเร็กเตอร์',
            agent: 'เอเจนต์'
          }
        },
        table: {
          started: 'เริ่มเมื่อ',
          status: 'สถานะ',
          kind: 'ชนิด',
          director: 'ไดเร็กเตอร์',
          agent: 'เอเจนต์',
          subject: 'หัวเรื่อง',
          actions: 'การทำงาน'
        },
        empty: 'ไม่มีการสนทนา',
        detail: {
          title: 'การสนทนา: {{id}}',
          finalize: 'ปิดงานเวิร์กสเปซ',
          finalizing: 'กำลังปิดงาน…',
          transcript: 'บทสนทนา',
          noMessages: 'ไม่มีข้อความ',
          labels: {
            lastActive: 'ครั้งสุดท้ายที่ใช้งาน',
            endedAt: 'สิ้นสุด'
          }
        },
        workspace: {
          title: 'ไอเท็มในเวิร์กสเปซ',
          add: {
            type: 'ชนิด',
            label: 'ป้ายกำกับ',
            description: 'คำอธิบาย',
            tags: 'แท็ก (คั่นด้วยจุลภาค)',
            data: 'ข้อมูล',
            mimeType: 'ชนิด Mime',
            encoding: 'การเข้ารหัส',
            encodingNone: '(ไม่มี)',
            refresh: 'รีเฟรชรายการ',
            add: 'เพิ่ม'
          },
          table: {
            type: 'ชนิด',
            provenance: 'ที่มา',
            tags: 'แท็ก',
            preview: 'ตัวอย่าง',
            mime: 'Mime',
            revision: 'รุ่น',
            created: 'สร้างเมื่อ',
            updated: 'อัปเดตเมื่อ',
            actions: 'การทำงาน'
          },
          empty: 'ไม่มีไอเท็มในเวิร์กสเปซ',
          editTitle: 'แก้ไขไอเท็มเวิร์กสเปซ'
        },
        confirm: {
          deleteOne: 'ลบการสนทนา {{id}} (รวมถึงลูกทั้งหมด)?',
          deleteAll: 'ลบการสนทนาที่แสดงทั้งหมด {{count}} รายการ?'
        }
      }
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    ns: ['common'],
    defaultNS: 'common'
  });

export default i18n;
