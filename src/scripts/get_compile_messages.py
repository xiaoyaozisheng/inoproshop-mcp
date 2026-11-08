import sys, scriptengine as script_engine, os, traceback, json

try:
    print("DEBUG: get_compile_messages script: Project='%s'" % PROJECT_FILE_PATH)
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    project_name = os.path.basename(PROJECT_FILE_PATH)
    target_app = None
    app_name = "N/A"

    # Try getting active application first
    try:
        target_app = primary_project.active_application
        if target_app:
            app_name = getattr(target_app, 'get_name', lambda: "Unnamed App")()
    except Exception as active_err:
        print("WARN: Could not get active application: %s" % active_err)

    # If no active app, search for the first one
    if not target_app:
        try:
            all_children = primary_project.get_children(True)
            for child in all_children:
                if hasattr(child, 'is_application') and child.is_application:
                    target_app = child
                    app_name = getattr(child, 'get_name', lambda: "Unnamed App")()
                    break
        except Exception as find_err:
            print("WARN: Error finding application object: %s" % find_err)

    if not target_app:
        raise RuntimeError("No application found in project '%s'" % project_name)

    # Extract compiler messages using multiple API patterns
    messages = []
    messages_found = False

    # Pattern 0 (PRIMARY, verified): per-category fetch via script_engine.system.
    # Two facts learned the hard way on InoProShop V1.9.0.1 (CODESYS SP11):
    #   1. App-level get_message_objects() does NOT exist -- an App is a
    #      ScriptObject and raises "object has no attribute get_message_objects".
    #   2. system.get_message_objects() WITHOUT a category GUID returns 0
    #      always, which is why this tool used to answer
    #      "No compile messages found." even when the IDE showed errors.
    # The working call is system.get_message_objects(<category guid>), and the
    # errors live in the Build category. So enumerate categories, union the
    # hardcoded compile GUIDs (enumeration can miss Build before a first
    # build), and fetch each one.
    CATEGORY_GUIDS = [
        '97F48D64-A2A3-4856-B640-75C046E37EA9',  # Build  <- real errors
        '220493A1-F49B-4416-9A3F-A545DB707CBE',  # Additional code checks
        '217BC73E-759B-4A3C-BFA1-991C938A6541',  # Precompile
    ]

    def _norm_g(g):
        return str(g).strip().strip('{}').lower()

    cat_guids = []
    cat_names = {}
    try:
        for c in script_engine.system.get_message_categories():
            g = str(c)
            if _norm_g(g) not in cat_guids:
                cat_guids.append(_norm_g(g))
    except Exception as e:
        print("DEBUG: get_message_categories() failed: %s" % e)

    for gs in CATEGORY_GUIDS:
        if _norm_g(gs) not in cat_guids:
            cat_guids.append(_norm_g(gs))
            print("DEBUG: merged hardcoded compile category %s" % gs)

    if hasattr(script_engine.system, 'get_message_objects'):
        for gs in cat_guids:
            try:
                cat_guid = script_engine.Guid('{%s}' % gs)
            except Exception as ge:
                print("DEBUG: Guid('%s') failed: %s" % (gs, ge))
                continue
            try:
                got = script_engine.system.get_message_objects(cat_guid)
            except Exception as me:
                print("DEBUG: get_message_objects(%s) failed: %s" % (gs, me))
                continue
            if got is None:
                continue
            n_cat = 0
            for msg in got:
                n_cat += 1
                entry = {}
                if hasattr(msg, 'severity'):
                    sev = str(msg.severity).lower()
                    if 'error' in sev:
                        entry['severity'] = 'error'
                    elif 'warning' in sev:
                        entry['severity'] = 'warning'
                    elif 'info' in sev:
                        entry['severity'] = 'info'
                    else:
                        entry['severity'] = sev
                else:
                    entry['severity'] = 'unknown'
                entry['text'] = getattr(msg, 'text', getattr(msg, 'message', str(msg)))
                if hasattr(msg, 'object_name'):
                    entry['object'] = msg.object_name
                elif hasattr(msg, 'source'):
                    entry['object'] = str(msg.source)
                if hasattr(msg, 'line_number'):
                    entry['line'] = msg.line_number
                elif hasattr(msg, 'position'):
                    entry['line'] = msg.position
                entry['category'] = cat_names.get(gs, gs)
                messages.append(entry)
            messages_found = True
            print("DEBUG: category %s -> %d msgs" % (gs, n_cat))

    # Pattern 1: target_app.get_message_objects()
    if not messages and hasattr(target_app, 'get_message_objects'):
        try:
            msg_objects = target_app.get_message_objects()
            if msg_objects is not None:
                messages_found = True
                for msg in msg_objects:
                    entry = {}
                    if hasattr(msg, 'severity'):
                        sev = str(msg.severity).lower()
                        if 'error' in sev:
                            entry['severity'] = 'error'
                        elif 'warning' in sev:
                            entry['severity'] = 'warning'
                        elif 'info' in sev:
                            entry['severity'] = 'info'
                        else:
                            entry['severity'] = sev
                    else:
                        entry['severity'] = 'unknown'
                    entry['text'] = getattr(msg, 'text', getattr(msg, 'message', str(msg)))
                    if hasattr(msg, 'object_name'):
                        entry['object'] = msg.object_name
                    elif hasattr(msg, 'source'):
                        entry['object'] = str(msg.source)
                    if hasattr(msg, 'line_number'):
                        entry['line'] = msg.line_number
                    elif hasattr(msg, 'position'):
                        entry['line'] = msg.position
                    messages.append(entry)
                print("DEBUG: Got %d messages from app.get_message_objects()" % len(messages))
        except Exception as e:
            print("DEBUG: app.get_message_objects() failed: %s" % e)

    # Pattern 2: script_engine.system.get_message_objects()
    if not messages_found and hasattr(script_engine, 'system'):
        se_sys = script_engine.system
        if hasattr(se_sys, 'get_message_objects'):
            try:
                msg_objects = se_sys.get_message_objects()
                if msg_objects is not None:
                    messages_found = True
                    for msg in msg_objects:
                        entry = {}
                        if hasattr(msg, 'severity'):
                            sev = str(msg.severity).lower()
                            if 'error' in sev:
                                entry['severity'] = 'error'
                            elif 'warning' in sev:
                                entry['severity'] = 'warning'
                            elif 'info' in sev:
                                entry['severity'] = 'info'
                            else:
                                entry['severity'] = sev
                        else:
                            entry['severity'] = 'unknown'
                        entry['text'] = getattr(msg, 'text', getattr(msg, 'message', str(msg)))
                        if hasattr(msg, 'object_name'):
                            entry['object'] = msg.object_name
                        elif hasattr(msg, 'source'):
                            entry['object'] = str(msg.source)
                        if hasattr(msg, 'line_number'):
                            entry['line'] = msg.line_number
                        elif hasattr(msg, 'position'):
                            entry['line'] = msg.position
                        messages.append(entry)
                    print("DEBUG: Got %d messages from system.get_message_objects()" % len(messages))
            except Exception as e:
                print("DEBUG: system.get_message_objects() failed: %s" % e)

    # Pattern 3: script_engine.system.get_messages() (older API)
    if not messages_found and hasattr(script_engine, 'system'):
        se_sys = script_engine.system
        if hasattr(se_sys, 'get_messages'):
            try:
                msg_objects = se_sys.get_messages()
                if msg_objects is not None:
                    messages_found = True
                    for msg in msg_objects:
                        entry = {}
                        if hasattr(msg, 'severity'):
                            sev = str(msg.severity).lower()
                            if 'error' in sev:
                                entry['severity'] = 'error'
                            elif 'warning' in sev:
                                entry['severity'] = 'warning'
                            elif 'info' in sev:
                                entry['severity'] = 'info'
                            else:
                                entry['severity'] = sev
                        else:
                            entry['severity'] = 'unknown'
                        entry['text'] = getattr(msg, 'text', getattr(msg, 'message', str(msg)))
                        if hasattr(msg, 'object_name'):
                            entry['object'] = msg.object_name
                        elif hasattr(msg, 'source'):
                            entry['object'] = str(msg.source)
                        if hasattr(msg, 'line_number'):
                            entry['line'] = msg.line_number
                        elif hasattr(msg, 'position'):
                            entry['line'] = msg.position
                        messages.append(entry)
                    print("DEBUG: Got %d messages from system.get_messages()" % len(messages))
            except Exception as e:
                print("DEBUG: system.get_messages() failed: %s" % e)

    for entry in messages:
        if 'text' in entry:
            entry['text'] = _to_unicode(entry['text'])
        if 'object' in entry:
            entry['object'] = _to_unicode(entry['object'])
        if 'severity' in entry:
            entry['severity'] = _to_unicode(entry['severity'])

    # _json_default is provided by the prepended _text_utils helper.
    messages_json = json.dumps(messages, ensure_ascii=False, default=_json_default)
    if isinstance(messages_json, unicode):
        messages_json_bytes = messages_json.encode('utf-8')
    else:
        messages_json_bytes = messages_json
    sys.stdout.write("### COMPILE_MESSAGES_START ###\n")
    sys.stdout.write(messages_json_bytes)
    sys.stdout.write("\n### COMPILE_MESSAGES_END ###\n")
    sys.stdout.flush()
    print("Messages Found: %s" % messages_found)
    print("Message Count: %d" % len(messages))
    print("SCRIPT_SUCCESS: Compile messages retrieved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error getting compile messages for project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
